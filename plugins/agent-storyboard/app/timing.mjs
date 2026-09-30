import { createHash } from "node:crypto";
export const spokenText = shots => shots.map(s => s.dialogue.trim()).filter(Boolean).join("\n");
export const dialogueKey = shots => createHash("sha256").update(JSON.stringify(shots.map(s => [s.id, s.dialogue]))).digest("hex");
export const voiceTextsMatch = (left, right) => String(left).normalize("NFKC").replace(/\s+/gu, "") === String(right).normalize("NFKC").replace(/\s+/gu, "");
export function estimateTiming(shots, totalMs, log = "") {
  if (!(totalMs > 0)) throw new Error("无有效音频时长");
  const boundaries = [...log.matchAll(/silence_start:\s*([\d.]+)/g)].map(m => Math.round(Number(m[1]) * 1000)).filter(n => n > 0 && n < totalMs);
  const spoken = shots.filter(s => s.dialogue.trim());
  if (!spoken.length) throw new Error("没有可对齐的镜头台词");
  const weights = spoken.map(s => [...s.dialogue.replace(/\s/g, "")].length);
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = 0, weight = 0;
  return spoken.map((s, index) => {
    weight += weights[index];
    const ideal = totalMs * weight / total;
    const near = boundaries.filter(n => n > cursor + 100 && Math.abs(n - ideal) < 600).sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0];
    const end = index === spoken.length - 1 ? totalMs : Math.max(cursor + 1, Math.min(totalMs - (spoken.length - index - 1), near ?? Math.round(ideal)));
    const row = { shotId: s.id, start: cursor, end, text: s.dialogue };
    cursor = end;
    return row;
  });
}
export function applyTiming(shots, take, timeline = take.timeline) {
  if (take.dialogueKey !== dialogueKey(shots)) throw new Error("台词或镜头顺序已改变，请重新对齐");
  const spoken = shots.filter(s => s.dialogue.trim());
  if (!Array.isArray(timeline) || timeline.length !== spoken.length) throw new Error("对齐镜头数量不匹配");
  let previous = 0;
  const durations = new Map();
  timeline.forEach((row, i) => {
    if (row.shotId !== spoken[i].id || !Number.isFinite(row.start) || !Number.isFinite(row.end) || row.start < previous || row.end <= row.start || row.end > take.durationMs) throw new Error("时间轴必须递增且在音频范围内");
    previous = row.end;
    durations.set(row.shotId, row);
  });
  return shots.map(shot => {
    const row = durations.get(shot.id);
    return row ? { ...shot, timeStart: row.start, timeEnd: row.end, duration: Math.round((row.end - row.start) / 10) / 100 } : shot;
  });
}
