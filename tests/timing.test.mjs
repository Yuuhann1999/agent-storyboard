import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTiming, applyTiming, dialogueKey, voiceTextsMatch } from "../timing.mjs";
const shots = [{ id: "a", dialogue: "你好", duration: 5 }, { id: "b", dialogue: "", duration: 7 }, { id: "c", dialogue: "再见", duration: 5 }];
test("timing snaps to nearby silence and preserves silent shots", () => {
  const timeline = estimateTiming(shots, 10000, "silence_start: 4.8");
  assert.equal(timeline[0].end, 4800);
  const result = applyTiming(shots, { dialogueKey: dialogueKey(shots), durationMs: 10000, timeline });
  assert.equal(result[0].duration, 4.8); assert.equal(result[1].duration, 7); assert.equal(result[2].duration, 5.2);
  assert.equal(result[0].timeStart, 0);
});
test("reject stale dialogue and invalid boundaries", () => {
  const take = { dialogueKey: dialogueKey(shots), durationMs: 10000, timeline: estimateTiming(shots, 10000) };
  assert.throws(() => applyTiming([...shots].reverse(), take));
  assert.throws(() => applyTiming(shots, take, [{ ...take.timeline[0], end: -1 }, take.timeline[1]]));
  assert.throws(() => applyTiming(shots, take, []));
});

test("voice text matching ignores whitespace-only differences", () => {
  assert.equal(voiceTextsMatch("第一句\n\n第二句", "第一句\n第二句"), true);
  assert.equal(voiceTextsMatch("第一句", "第一段"), false);
});
