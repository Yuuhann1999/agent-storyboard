import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateImageWithCodex, buildInstruction, ImageGenError } from "../codex-image.mjs";

// 假的 codex：从 stdin 的指令里取出 OUTPUT PATH，按脚本行为写图片 / 报错 / 卡住。
async function fakeCodex(directory, body) {
  const path = join(directory, "codex");
  await writeFile(path, `#!/usr/bin/env node
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const out = /OUTPUT PATH: (.+)/.exec(Buffer.concat(chunks).toString())[1].trim();
  const fs = require("node:fs");
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2000, 7)]);
  ${body}
});
`);
  await chmod(path, 0o755);
  return path;
}

test("instruction carries prompt, aspect ratio, output path and reference count", () => {
  const text = buildInstruction({ prompt: "a red fox", outputPath: "/tmp/x.png", aspect: "16:9", refImages: ["/tmp/ref.png"] });
  for (const part of ["a red fox", "ASPECT RATIO: 16:9", "OUTPUT PATH: /tmp/x.png", "1 image(s)"]) assert.ok(text.includes(part), part);
});

test("returns the generated image", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-storyboard-img-"));
  try {
    const command = await fakeCodex(dir, `fs.writeFileSync(out, png); console.log('{"type":"turn.completed"}');`);
    const result = await generateImageWithCodex({ prompt: "fox", outputPath: join(dir, "out", "fox.png"), command, retries: 0, pollMs: 50 });
    assert.ok(result.bytes > 1000);
    assert.equal((await readFile(result.path)).subarray(1, 4).toString(), "PNG");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("stops a Codex process that hangs after the image is written", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-storyboard-img-"));
  try {
    const command = await fakeCodex(dir, `fs.writeFileSync(out, png); setInterval(() => {}, 1000);`);
    const started = Date.now();
    const result = await generateImageWithCodex({ prompt: "fox", outputPath: join(dir, "hang.png"), command, retries: 0, pollMs: 50, graceMs: 150, timeoutMs: 20000 });
    assert.ok(result.bytes > 1000);
    assert.ok(Date.now() - started < 10000, "should not wait for the timeout");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("reports Codex errors with the real cause, and a missing file as no_output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-storyboard-img-"));
  try {
    const failing = await fakeCodex(dir, `console.log(JSON.stringify({ type: "error", message: "usage limit reached" })); process.exit(1);`);
    await assert.rejects(generateImageWithCodex({ prompt: "fox", outputPath: join(dir, "a.png"), command: failing, retries: 0, pollMs: 50 }), /usage limit reached/);
    const silent = await fakeCodex(dir, `process.exit(0);`);
    await assert.rejects(generateImageWithCodex({ prompt: "fox", outputPath: join(dir, "b.png"), command: silent, retries: 0, pollMs: 50 }), (error) => error instanceof ImageGenError && error.kind === "no_output");
    await assert.rejects(stat(join(dir, "b.png")));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("rejects unsafe paths and a missing Codex CLI", async () => {
  await assert.rejects(generateImageWithCodex({ prompt: "fox", outputPath: "/tmp/a;rm -rf.png" }), (error) => error.kind === "invalid_args");
  await assert.rejects(generateImageWithCodex({ prompt: "fox", outputPath: join(tmpdir(), "agent-storyboard-none.png"), command: "/nonexistent/codex", retries: 0 }), (error) => error.kind === "codex_not_installed");
});
