import { test } from "node:test";
import assert from "node:assert/strict";
import { moveShot, cloneShot, shotMatches, shotStatusCounts } from "../public/shots.js";
import { inspectPacingDetailed, inspectPacing } from "../public/pacing.js";

const shots = ["a", "b", "c", "d"].map((id) => ({ id }));

test("moveShot reorders without mutating and ignores no-ops", () => {
  assert.deepEqual(moveShot(shots, 0, 2).map((s) => s.id), ["b", "c", "a", "d"]);
  assert.deepEqual(moveShot(shots, 3, 0).map((s) => s.id), ["d", "a", "b", "c"]);
  assert.deepEqual(shots.map((s) => s.id), ["a", "b", "c", "d"]);
  assert.equal(moveShot(shots, 1, 1), shots);
  assert.equal(moveShot(shots, -1, 2), shots);
  assert.equal(moveShot(shots, 0, -5).length, 4);
  assert.equal(moveShot(shots, 3, 99), shots);
});

test("cloneShot keeps text and settings but drops media and generation state", () => {
  const copy = cloneShot({
    id: "old", dialogue: "你好", visualPrompt: "雨", generator: "image-gen", rollType: "A-ROLL",
    mediaUrl: "/media/p/shot-001.png", generationStatus: "ready", generationTaskId: "t1", generationError: "x"
  }, "new-id");
  assert.equal(copy.id, "new-id");
  assert.equal(copy.dialogue, "你好");
  assert.equal(copy.generator, "image-gen");
  assert.equal(copy.mediaUrl, "");
  assert.equal(copy.generationStatus, "idle");
  assert.equal(copy.generationTaskId, "");
  assert.notEqual(cloneShot({}).id, cloneShot({}).id);
});

test("shotMatches searches dialogue, prompt and notes case-insensitively", () => {
  const shot = { dialogue: "蒸馏是什么", visualPrompt: "Tech vlogger", notes: "Hook" };
  assert.ok(shotMatches(shot, ""));
  assert.ok(shotMatches(shot, "  蒸馏 "));
  assert.ok(shotMatches(shot, "vlogger"));
  assert.ok(shotMatches(shot, "hook"));
  assert.ok(!shotMatches(shot, "不存在"));
});

test("shotStatusCounts ignores manual shots and includes covers", () => {
  const counts = shotStatusCounts(
    [{ generator: "image-gen", generationStatus: "processing" }, { generator: "manual", generationStatus: "pending" }, { generator: "remotion", generationStatus: "failed" }],
    [{ generationStatus: "pending" }, { generationStatus: "ready" }]
  );
  assert.deepEqual(counts, { pending: 1, processing: 1, failed: 1 });
});

test("pacing details point at the shots involved and match the plain messages", () => {
  const roll = { rollType: "A-ROLL", duration: 5, dialogue: "" };
  const list = [roll, roll, roll, { ...roll, rollType: "B-ROLL", duration: 20 }];
  const detailed = inspectPacingDetailed(list);
  assert.deepEqual(detailed.map((item) => item.indexes), [[0, 1, 2], [3]]);
  assert.deepEqual(inspectPacing(list), detailed.map((item) => item.message));
});
