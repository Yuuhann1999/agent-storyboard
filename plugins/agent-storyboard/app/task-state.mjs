export const GENERATION_TIMEOUT_MS = 30 * 60 * 1000;
export function expireTasks(project, now = Date.now()) {
  let changed = false;
  for (const item of [...project.shots, ...Object.values(project.covers || {})]) {
    if (item.generationStatus !== "processing") continue;
    const last = Date.parse(item.generationHeartbeatAt || item.generationStartedAt || item.generationRequestedAt);
    if (!Number.isFinite(last) || now - last > GENERATION_TIMEOUT_MS) {
      item.generationStatus = "failed";
      item.generationError = "任务超过 30 分钟未更新，已释放，可重新生成";
      item.generationCompletedAt = new Date(now).toISOString();
      changed = true;
    }
  }
  return changed;
}
