export function newShotId() {
  return `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// 返回新数组；from / to 越界或相同时原样返回。
export function moveShot(shots, from, to) {
  if (from === to || from < 0 || from >= shots.length) return shots;
  const target = Math.max(0, Math.min(shots.length - 1, to));
  if (target === from) return shots;
  const next = shots.slice();
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

// 复制镜头的文字与设置，不带素材和生成状态：
// 素材文件按镜头 ID 命名，共用同一个文件会导致删除其中一个时另一个失效。
export function cloneShot(shot, id = newShotId()) {
  return {
    ...shot,
    id,
    mediaUrl: "",
    timeStart: null,
    timeEnd: null,
    generationStatus: "idle",
    generationTaskId: "",
    generationError: "",
    generationRequestedAt: null,
    generationStartedAt: null,
    generationHeartbeatAt: null,
    generationCompletedAt: null
  };
}

export function shotMatches(shot, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  return [shot.dialogue, shot.visualPrompt, shot.notes]
    .some((text) => String(text || "").toLowerCase().includes(needle));
}

export function shotStatusCounts(shots, covers = []) {
  const counts = { pending: 0, processing: 0, failed: 0 };
  for (const item of [...shots, ...covers]) {
    if (item.generator === "manual") continue;
    if (item.generationStatus in counts) counts[item.generationStatus]++;
  }
  return counts;
}
