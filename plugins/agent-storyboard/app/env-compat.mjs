// 品牌从 Codex Storyboard 改为 Agent Storyboard 之后，继续认旧的环境变量和旧数据目录，
// 已经在用的人不需要改任何配置，也不会丢项目。
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

for (const key of Object.keys(process.env)) {
  if (!key.startsWith("CODEX_STORYBOARD_")) continue;
  const current = `AGENT_STORYBOARD_${key.slice("CODEX_STORYBOARD_".length)}`;
  if (process.env[current] === undefined) process.env[current] = process.env[key];
}

export function defaultDataDir(home = homedir()) {
  const current = join(home, ".agent-storyboard");
  const legacy = join(home, ".codex-storyboard");
  return existsSync(current) || !existsSync(legacy) ? current : legacy;
}
