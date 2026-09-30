import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultDataDir } from "../env-compat.mjs";

test("keeps using the old data directory when only that one exists", async () => {
  const home = await mkdtemp(join(tmpdir(), "agent-storyboard-home-"));
  try {
    assert.equal(defaultDataDir(home), join(home, ".agent-storyboard"));
    await mkdir(join(home, ".codex-storyboard"));
    assert.equal(defaultDataDir(home), join(home, ".codex-storyboard"));
    await mkdir(join(home, ".agent-storyboard"));
    assert.equal(defaultDataDir(home), join(home, ".agent-storyboard"));
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("old CODEX_STORYBOARD_* variables are still honoured, new ones win", () => {
  const read = (env) => execFileSync(process.execPath, ["-e", 'import("./env-compat.mjs").then(() => console.log(process.env.AGENT_STORYBOARD_PORT))'], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" }).trim();
  assert.equal(read({ CODEX_STORYBOARD_PORT: "1111" }), "1111");
  assert.equal(read({ CODEX_STORYBOARD_PORT: "1111", AGENT_STORYBOARD_PORT: "2222" }), "2222");
});
