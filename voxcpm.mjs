// VoxCPM 在线配音的 Node 客户端：直接走 Gradio 的 HTTP 接口，不需要 Python。
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

export const VOXCPM_API_BASE = "https://voxcpm.modelbest.cn";
// 自建服务或测试时可以用 AGENT_STORYBOARD_VOXCPM_URL 指向别的地址。
export const voxcpmBase = () => String(process.env.AGENT_STORYBOARD_VOXCPM_URL || VOXCPM_API_BASE).replace(/\/+$/, "");

async function readJson(response, action) {
  const text = await response.text();
  if (!response.ok) throw new Error(`${action}失败（HTTP ${response.status}）：${text.slice(0, 300)}`);
  try { return JSON.parse(text); }
  catch { throw new Error(`${action}返回了无法解析的内容：${text.slice(0, 200)}`); }
}

async function uploadReference(base, file, signal) {
  const form = new FormData();
  form.append("files", new Blob([await readFile(file)]), basename(file));
  const [serverPath] = await readJson(await fetch(`${base}/gradio_api/upload`, { method: "POST", body: form, signal }), "上传参考音频");
  if (!serverPath) throw new Error("上传参考音频失败：服务没有返回文件路径");
  return { path: serverPath, orig_name: basename(file), meta: { _type: "gradio.FileData" } };
}

// Gradio 的事件流：一行 "event: xxx"，随后一行 "data: ..."，空行分隔。
export function parseEventStream(text) {
  const events = [];
  let event = "message";
  let data = [];
  const flush = () => {
    if (data.length) events.push({ event, data: data.join("\n") });
    event = "message";
    data = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (line === "") flush();
    else if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  flush();
  return events;
}

export async function generateVoxcpm({
  text,
  output,
  instruction = "",
  promptWav = "",
  promptText = "",
  apiBase = voxcpmBase(),
  cfg = 2.0,
  steps = 10,
  normalize = true,
  denoise = false,
  userId = "agent-storyboard",
  timeoutMs = 10 * 60 * 1000
}) {
  const base = String(apiBase).replace(/\/+$/, "");
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const reference = promptWav ? await uploadReference(base, promptWav, signal) : null;
    const { event_id: eventId } = await readJson(await fetch(`${base}/gradio_api/call/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      // 参数顺序对应服务的 /generate 接口：text, control_instruction, ref_wav, use_prompt_text,
      // prompt_text_value, cfg_value, do_normalize, denoise, dit_steps, user_id
      body: JSON.stringify({ data: [text, instruction, reference, Boolean(reference && promptText), promptText, cfg, normalize, denoise, steps, userId] })
    }), "提交配音任务");
    if (!eventId) throw new Error("提交配音任务失败：服务没有返回任务编号");

    const stream = await fetch(`${base}/gradio_api/call/generate/${eventId}`, { signal });
    if (!stream.ok) throw new Error(`读取配音结果失败（HTTP ${stream.status}）`);
    const events = parseEventStream(await stream.text());
    const failed = events.find((item) => item.event === "error");
    if (failed) throw new Error(`配音服务返回错误：${failed.data === "null" ? "服务繁忙或文本不被接受，请稍后重试" : failed.data.slice(0, 300)}`);
    const complete = events.find((item) => item.event === "complete");
    if (!complete) throw new Error("配音服务没有返回结果，请稍后重试");
    const [audio] = JSON.parse(complete.data);
    const url = audio?.url || (audio?.path ? `${base}/gradio_api/file=${audio.path}` : "");
    if (!url) throw new Error("配音服务返回的结果里没有音频文件");

    const download = await fetch(url, { signal });
    if (!download.ok) throw new Error(`下载配音音频失败（HTTP ${download.status}）`);
    await writeFile(output, Buffer.from(await download.arrayBuffer()));
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") throw new Error(`配音超时（超过 ${Math.round(timeoutMs / 60000)} 分钟），请稍后重试`);
    if (error.cause?.code && /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/.test(error.cause.code)) {
      throw new Error(`无法连接配音服务（${base}）：请检查网络`);
    }
    throw error;
  }
}
