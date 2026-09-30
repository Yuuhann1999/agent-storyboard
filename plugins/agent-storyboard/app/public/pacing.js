// 每条建议带上涉及的镜头下标，界面据此在对应行上标出提示。
export function inspectPacingDetailed(shots) {
  const warnings = [];
  let start = 0;
  for (let i = 1; i <= shots.length; i++) {
    if (i === shots.length || shots[i].rollType !== shots[start].rollType) {
      if (i - start >= 3) {
        warnings.push({
          message: `镜头 ${start + 1}–${i} 连续使用 ${shots[start].rollType}，可检查画面变化是否足够`,
          indexes: Array.from({ length: i - start }, (_, k) => start + k)
        });
      }
      start = i;
    }
  }
  shots.forEach((shot, index) => {
    const seconds = Number(shot.duration);
    const add = (message) => warnings.push({ message: `镜头 ${index + 1} ${message}`, indexes: [index] });
    if (!Number.isFinite(seconds) || seconds <= 0) add("时长无效");
    else if (seconds < 1) add("不足 1 秒，可能难以看清");
    else if (seconds > 15) add("超过 15 秒，可检查停留是否过长");
    const words = [...String(shot.dialogue || "").replace(/\s/g, "")].length;
    if (seconds > 0 && words / seconds > 6) add("台词较密，建议试听确认语速");
  });
  return warnings;
}

export function inspectPacing(shots) {
  return inspectPacingDetailed(shots).map((item) => item.message);
}
