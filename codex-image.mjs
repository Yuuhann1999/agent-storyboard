// 通过本机 Codex CLI 的 image_gen 出图，供没有内置生图能力的 Agent（例如 Claude Code）使用。
// 原理：让 `codex exec` 调用它自带的 image_gen，把结果放到指定路径。需要本机装了 Codex 并已登录。
import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export class ImageGenError extends Error {
  constructor(kind, message, retryable = true) {
    super(message);
    this.name = "ImageGenError";
    this.kind = kind;
    this.retryable = retryable;
  }
}

const SHELL_METACHAR = /[;|&`$<>\n\r()'"]/;
const lockPath = join(tmpdir(), "agent-storyboard-codex-image.lock");

// 输出路径会原样写进发给 Codex 的指令，由它的 shell 去复制文件，含 shell 元字符会被误解析，所以直接拒绝。
function assertSafePath(label, value) {
  if (SHELL_METACHAR.test(value)) throw new ImageGenError("invalid_args", `${label} 含有不安全的字符：${value}`, false);
}

async function acquireLock(timeoutMs = 30 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const fd = openSync(lockPath, "wx");
      return async () => { closeSync(fd); await unlink(lockPath).catch(() => {}); };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const info = await stat(lockPath).catch(() => null);
      if (!info || Date.now() - info.mtimeMs > 30 * 60 * 1000) await unlink(lockPath).catch(() => {});
      else await delay(500);
    }
  }
  throw new ImageGenError("busy", "等待其他生图任务超时", true);
}

export function buildInstruction({ prompt, outputPath, aspect, refImages }) {
  const refHint = refImages.length
    ? `\nREFERENCE IMAGES (attached above): ${refImages.length} image(s) provided for style/composition guidance.\n`
    : "";
  return `You have an internal tool called image_gen for image generation. You MUST call it before doing anything else.

TASK: Generate an image with the spec below, then save to disk.

PROMPT:
${prompt}

ASPECT RATIO: ${aspect}
OUTPUT PATH: ${outputPath}
${refHint}
STEPS:
1. Call image_gen with the prompt and aspect ratio above${refImages.length ? " (using the attached reference images for guidance)" : ""}.
2. Move or copy ONLY the image produced by that image_gen call from Codex default location ($CODEX_HOME/generated_images/...) to: ${outputPath}
3. Verify with: ls -la ${outputPath}
4. Reply with ONLY this JSON line (no markdown fences, no other text):
   {"status":"ok","path":"${outputPath}","bytes":<file_size_in_bytes>}

HARD CONSTRAINTS:
- Do NOT search for, find, inspect, reuse, or copy any pre-existing files from $CODEX_HOME/generated_images/ or any other directory.
- Do NOT run ls/find/rg/grep/glob over $CODEX_HOME/generated_images/ before image_gen has been called.
- You MUST call image_gen first. Only after image_gen completes may you copy the newly created file from this turn.
- Do NOT use curl, wget, Python, or any external API.
- Do NOT use bash to fabricate an image; only image_gen produces real pixels.
- Use ONLY the image_gen internal tool.`;
}

// 系统代理只在 macOS 上补一次，避免 Codex 子进程在需要代理的网络里连不上。
function macSystemProxyEnv() {
  if (process.platform !== "darwin" || process.env.HTTPS_PROXY || process.env.https_proxy) return {};
  const output = spawnSync("scutil", ["--proxy"], { encoding: "utf8" }).stdout || "";
  const enabled = output.match(/HTTPSEnable\s*:\s*(\d+)/)?.[1] === "1";
  const host = output.match(/HTTPSProxy\s*:\s*(\S+)/)?.[1];
  const port = output.match(/HTTPSPort\s*:\s*(\d+)/)?.[1];
  if (!enabled || !host || !port) return {};
  const proxy = `http://${host}:${port}`;
  return { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy };
}

function streamErrors(raw) {
  const errors = new Set();
  const noise = (message) => message.includes("unrecognized configuration setting") || message.toLowerCase().includes("skill descriptions were shortened");
  for (const line of raw.split("\n")) {
    try {
      const event = JSON.parse(line.trim());
      if (event.type === "error" && event.message && !noise(String(event.message))) errors.add(String(event.message).trim());
      if (event.type === "turn.failed" && event.error?.message) errors.add(String(event.error.message).trim());
      if (event.type === "item.completed" && event.item?.type === "error" && event.item?.message) {
        const message = String(event.item.message).trim();
        if (!noise(message)) errors.add(message);
      }
    } catch { /* 不是 JSON 的行忽略 */ }
  }
  return [...errors];
}

async function isImage(path) {
  const info = await stat(path).catch(() => null);
  if (!info || info.size < 1000) return false;
  const head = (await readFile(path)).subarray(0, 12);
  const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const jpeg = head[0] === 0xff && head[1] === 0xd8;
  const webp = head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WEBP";
  return png || jpeg || webp;
}

function runCodex({ instruction, refImages, outputPath, timeoutMs, graceMs, pollMs, command }) {
  return new Promise((resolvePromise, reject) => {
    const args = ["exec", "--json", "--sandbox", "danger-full-access", "--skip-git-repo-check"];
    for (const image of refImages) args.push("--image", image);
    args.push("-");
    const startedAt = Date.now();
    const child = spawn(command, args, {
      env: { ...process.env, ...macSystemProxyEnv() },
      stdio: ["pipe", "pipe", "pipe"],
      // 独立进程组：Codex 会派生孙进程，收尾时整棵杀，避免它们占住管道。
      detached: process.platform !== "win32"
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputReady = false;
    let terminal = null;
    let settled = false;
    let graceTimer;

    const killTree = (signal) => {
      if (process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, signal); return; } catch { /* 进程组已不在 */ }
      }
      try { child.kill(signal); } catch { /* 已退出 */ }
    };
    const stop = () => { killTree("SIGTERM"); setTimeout(() => killTree("SIGKILL"), 2000).unref(); };

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error.code === "ENOENT"
        ? new ImageGenError("codex_not_installed", "未检测到 Codex CLI：请先安装并登录 Codex（codex login）", false)
        : new ImageGenError("spawn_failed", `无法启动 Codex：${error.message}`));
    });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (!terminal && stderr.includes("image generation failed: network error") && stderr.includes("/backend-api/codex/images/generations")) {
        terminal = new ImageGenError("network_error", "ChatGPT 图片服务网络连接失败，请检查网络或代理后重试");
        stop();
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(instruction);

    // 输出文件出现且大小稳定后，给一小段宽限期就主动收尾：
    // codex exec 常在出图后挂在收尾阶段，图片本身是好的，等下去只会超时误杀。
    let lastSize = -1;
    const poll = setInterval(() => {
      stat(outputPath).then((info) => {
        if (outputReady || info.mtimeMs < startedAt || info.size < 1000) return;
        if (info.size !== lastSize) { lastSize = info.size; return; }
        outputReady = true;
        graceTimer = setTimeout(stop, graceMs);
      }).catch(() => {});
    }, pollMs);
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);

    const cleanup = () => { clearTimeout(timer); clearInterval(poll); clearTimeout(graceTimer); };
    const done = (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (terminal) return reject(terminal);
      if (outputReady) return resolvePromise({ stdout });
      if (timedOut) return reject(new ImageGenError("timeout", `Codex 生图超时（超过 ${Math.round(timeoutMs / 1000)} 秒）`));
      if (code !== 0) {
        const detail = streamErrors(stdout).join(" | ") || stderr.trim().slice(-300) || `退出码 ${code}`;
        return reject(new ImageGenError("spawn_failed", `Codex 生图失败：${detail}`));
      }
      resolvePromise({ stdout });
    };
    // 用 exit 而不是 close：孙进程占着管道时 close 永远不来。
    child.on("exit", done);
  });
}

export async function generateImageWithCodex({
  prompt,
  outputPath,
  aspect = "1:1",
  refImages = [],
  timeoutMs = 8 * 60 * 1000,
  retries = 1,
  graceMs = 10_000,
  pollMs = 2000,
  command = process.env.AGENT_STORYBOARD_CODEX || "codex"
}) {
  if (!String(prompt || "").trim()) throw new ImageGenError("invalid_args", "缺少生图提示词", false);
  const output = isAbsolute(outputPath) ? outputPath : resolve(outputPath);
  const refs = refImages.map((image) => (isAbsolute(image) ? image : resolve(image)));
  assertSafePath("输出路径", output);
  refs.forEach((image) => assertSafePath("参考图路径", image));
  await mkdir(dirname(output), { recursive: true });

  const release = await acquireLock();
  try {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await rm(output, { force: true });
      try {
        await runCodex({ instruction: buildInstruction({ prompt, outputPath: output, aspect, refImages: refs }), refImages: refs, outputPath: output, timeoutMs, graceMs, pollMs, command });
        if (!(await isImage(output))) throw new ImageGenError("no_output", "Codex 已结束，但没有生成有效的图片文件");
        return { path: output, bytes: (await stat(output)).size };
      } catch (error) {
        lastError = error;
        if (!(error instanceof ImageGenError) || !error.retryable || attempt === retries) break;
      }
    }
    throw lastError;
  } finally {
    await release();
  }
}

export async function codexImageAvailable() {
  const version = spawnSync(process.env.AGENT_STORYBOARD_CODEX || "codex", ["--version"], { encoding: "utf8" });
  if (version.error || version.status !== 0) return { ok: false, reason: "not_installed" };
  const login = spawnSync(process.env.AGENT_STORYBOARD_CODEX || "codex", ["login", "status"], { encoding: "utf8" });
  return login.status === 0 ? { ok: true } : { ok: false, reason: "not_logged_in" };
}
