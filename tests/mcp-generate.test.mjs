import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import readline from "node:readline";

test("generate_storyboard_image claims, generates through Codex, and returns the image to the shot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-storyboard-mcp-"));
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));

  // 假的 codex：--version / login status 直接成功；出图时按指令里的 OUTPUT PATH 写一张 PNG。
  const fake = join(directory, "codex");
  await writeFile(fake, `#!/usr/bin/env node
if (process.argv.includes("--version") || process.argv.includes("login")) { console.log("fake"); process.exit(0); }
const chunks = []; process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const input = Buffer.concat(chunks).toString();
  const out = /OUTPUT PATH: (.+)/.exec(input)[1].trim();
  if (!/ASPECT RATIO: 9:16/.test(input) || !/neon rain/.test(input)) process.exit(3);
  require("node:fs").writeFileSync(out, Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(3000, 1)]));
});
`);
  await chmod(fake, 0o755);

  const app = spawn(process.execPath, ["server.mjs", "--port", String(port), "--data-dir", directory], { windowsHide: true });
  const url = `http://127.0.0.1:${port}`;
  const mcp = spawn(process.execPath, ["plugins/agent-storyboard/mcp/server.mjs"], {
    windowsHide: true,
    env: { ...process.env, AGENT_STORYBOARD_URL: url, AGENT_STORYBOARD_CODEX: fake }
  });
  const pending = new Map();
  readline.createInterface({ input: mcp.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
  });
  let nextId = 1;
  const call = (method, params) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    mcp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  const api = async (path, method = "GET", body) => (await fetch(url + path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) })).json();
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${url}/api/health`)).ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const listed = await call("tools/list", {});
    assert.ok(listed.result.tools.some((tool) => tool.name === "generate_storyboard_image"));

    const project = await api("/api/projects", "POST", { title: "Neon", aspectRatio: "9:16", shots: [{ generator: "image-gen", visualPrompt: "neon rain over a night street" }] });
    const queued = await api("/api/generation/tasks", "POST", { projectId: project.id, shotIds: [project.shots[0].id] });
    const taskId = queued.queued[0].taskId;

    const result = await call("tools/call", { name: "generate_storyboard_image", arguments: { taskId } });
    assert.ok(!result.error, JSON.stringify(result.error));
    assert.ok(!result.result.isError, JSON.stringify(result.result));
    const after = await api(`/api/projects/${project.id}`);
    assert.equal(after.shots[0].generationStatus, "ready");
    assert.match(after.shots[0].mediaUrl, /^\/media\//);
    const image = await fetch(url + after.shots[0].mediaUrl);
    assert.equal(image.status, 200);

    // 非生图任务被拒绝，并且不会改动状态
    const manual = await api("/api/projects", "POST", { title: "Manual", shots: [{ generator: "hyperframes", visualPrompt: "x" }] });
    const q2 = await api("/api/generation/tasks", "POST", { projectId: manual.id, shotIds: [manual.shots[0].id] });
    const refused = await call("tools/call", { name: "generate_storyboard_image", arguments: { taskId: q2.queued[0].taskId } });
    assert.ok(refused.error || refused.result?.isError);
    assert.equal((await api(`/api/projects/${manual.id}`)).shots[0].generationStatus, "pending");
  } finally {
    mcp.kill();
    app.kill();
    await rm(directory, { recursive: true, force: true });
  }
});
