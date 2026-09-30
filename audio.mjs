import { readFile, writeFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { run, ffmpeg, ffprobe, whisper, whisperModel } from "./runtime.mjs";
import { generateVoxcpm } from "./voxcpm.mjs";
import { matchRecognition } from "./recognition.mjs";

async function verifyVoiceRuntime() {
  for (const [command, label] of [[ffmpeg, "FFmpeg"], [ffprobe, "FFprobe"]]) {
    try {
      await run(command, ["-version"]);
    } catch (error) {
      throw new Error(`${label} 不可用（${command}）。请安装 FFmpeg，或设置 AGENT_STORYBOARD_${label === "FFmpeg" ? "FFMPEG" : "FFPROBE"} 指向可执行文件。原始错误：${error.message}`);
    }
  }
}

export async function alignVoice(path, shots, totalMs) {
  if (!(await stat(whisperModel).catch(() => null))) throw new Error("Whisper 本地模型未安装，请先完成语音环境安装");
  const directory = await mkdtemp(join(tmpdir(), "codex-whisper-"));
  try {
    const wav = join(directory, "speech.wav"), output = join(directory, "recognition");
    await run(ffmpeg, ["-y", "-i", path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], 60000);
    await run(whisper, ["-m", whisperModel, "-f", wav, "-l", "zh", "-ojf", "-of", output, "-t", "4"], 30 * 60 * 1000);
    const result = JSON.parse(await readFile(`${output}.json`, "utf8"));
    const segments = (result.transcription || []).flatMap(segment => {
      const tokens = (segment.tokens || []).filter(token => !token.text?.startsWith("[_") && token.offsets?.to > token.offsets?.from);
      const parts = tokens.length ? tokens : [segment];
      return parts.map(part => ({ text: part.text, start: part.offsets?.from, end: part.offsets?.to }));
    }).filter(segment => Number.isFinite(segment.start) && segment.end > segment.start);
    return { timeline: matchRecognition(shots, segments, totalMs), recognition: result.transcription.map(s => ({ text: s.text, start: s.offsets.from, end: s.offsets.to })), engine: "whisper.cpp-large-v3-turbo" };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function audioDuration(path) {
  const result = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "json", path]);
  const duration = Number(JSON.parse(result).format?.duration);
  if (!(duration > 0) || !Number.isFinite(duration)) throw new Error("无法读取音频时长");
  return Math.round(duration * 1000);
}

// 配音模型是自回归的：一次生成得太长，音色会越往后越偏离参考音频。
// 但切得太碎又会带来很多接缝：每段首尾都有静音、语气也会被打断，整体听感和时长都变差。
// 折中：整篇文案大约每 800 字（约 1.5 分钟）一段，尽量均分成 N 份，2000 多字就是 3 段左右；
// 只在句子结尾接缝，能落在段落结尾就落在段落结尾。每一段都重新使用同一份原始参考音频。
export function splitVoiceText(text, { maxChars = Number(process.env.AGENT_STORYBOARD_VOICE_CHUNK_CHARS) || 800 } = {}) {
  const paragraphs = String(text || "").split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const sentences = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const parts = (paragraph.match(/[^。！？!?；;]+[。！？!?；;]*/g) || [paragraph]).map((item) => item.trim()).filter(Boolean);
    parts.forEach((sentence, index) => sentences.push({ text: sentence, paragraphEnd: index === parts.length - 1 && paragraphIndex < paragraphs.length - 1 }));
  });
  const total = sentences.reduce((sum, item) => sum + item.text.length, 0);
  if (!total) return [];
  const count = Math.max(1, Math.ceil(total / maxChars));
  const target = total / count;

  // 每个切点选最接近“理想均分位置”的句尾；落在段落结尾的略优先。
  const cumulative = [];
  sentences.reduce((sum, item, index) => { cumulative[index] = sum + item.text.length; return cumulative[index]; }, 0);
  const cuts = [];
  let from = 0;
  for (let k = 1; k < count; k++) {
    const ideal = k * target;
    let best = -1;
    let bestCost = Infinity;
    for (let i = from; i < sentences.length - (count - k); i++) {
      const cost = Math.abs(cumulative[i] - ideal) - (sentences[i].paragraphEnd ? target * 0.06 : 0);
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    if (best < 0) break;
    cuts.push(best);
    from = best + 1;
  }
  const chunks = [];
  let start = 0;
  for (const end of [...cuts, sentences.length - 1]) {
    const slice = sentences.slice(start, end + 1);
    chunks.push({ text: slice.map((item) => item.text).join(""), paragraphEnd: slice[slice.length - 1].paragraphEnd });
    start = end + 1;
  }
  return chunks;
}

// 用本地 Whisper 识别参考音频里说了什么。提供原文后模型会按“带文本引导”的方式还原音色，
// 比只给音频稳定得多。识别失败时返回空字符串，退回纯音频克隆。
export async function transcribeReference(path) {
  if (!(await stat(whisperModel).catch(() => null))) return "";
  const directory = await mkdtemp(join(tmpdir(), "agent-storyboard-ref-"));
  try {
    const wav = join(directory, "reference.wav");
    const output = join(directory, "text");
    await run(ffmpeg, ["-y", "-i", path, "-t", "60", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], 60000);
    await run(whisper, ["-m", whisperModel, "-f", wav, "-l", "auto", "-ojf", "-of", output, "-t", "4"], 5 * 60 * 1000);
    const result = JSON.parse(await readFile(`${output}.json`, "utf8"));
    return (result.transcription || []).map((segment) => String(segment.text || "").trim()).join("").trim();
  } catch {
    return "";
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function synthesizeChunk(chunk, index, { directory, id, instruction, promptWav, promptText }) {
  const raw = join(directory, `${id}-c${index}.raw`);
  const wav = join(directory, `${id}-c${index}.wav`);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await generateVoxcpm({ text: chunk.text, output: raw, instruction, promptWav, promptText });
      // 每段单独做响度归一，拼接后音量才不会忽大忽小
      // 修掉每段首尾模型自带的静音，再做响度归一，拼接后音量才一致、接缝处停顿才可控
      const trim = "silenceremove=start_periods=1:start_silence=0.03:start_threshold=-48dB,areverse,silenceremove=start_periods=1:start_silence=0.03:start_threshold=-48dB,areverse";
      await run(ffmpeg, ["-y", "-i", raw, "-af", `${trim},loudnorm=I=-18:TP=-1.5:LRA=11`, "-ar", "48000", "-ac", "1", wav], 120000);
      await rm(raw, { force: true });
      return wav;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw new Error(`第 ${index + 1} 段配音失败（“${chunk.text.slice(0, 16)}…”）：${lastError.message}`);
}

export async function generateVoice({ directory, id, text, instruction, promptWav, promptText, onProgress }) {
  const output = join(directory, `${id}.wav`);
  const temporary = [];
  let convertedPromptWav = null;
  try {
    await verifyVoiceRuntime();
    let promptForVoice = promptWav;
    if (promptWav && extname(String(promptWav)).toLowerCase() !== ".wav") {
      convertedPromptWav = join(directory, `${id}-prompt.wav`);
      await run(ffmpeg, ["-y", "-i", String(promptWav), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", convertedPromptWav], 60000);
      promptForVoice = convertedPromptWav;
    }
    const chunks = splitVoiceText(text);
    if (!chunks.length) throw new Error("没有可配音的文字");
    const parts = [];
    for (const [index, chunk] of chunks.entries()) {
      const wav = await synthesizeChunk(chunk, index, {
        directory, id, instruction,
        promptWav: promptForVoice ? String(promptForVoice) : "",
        promptText: String(promptText || "")
      });
      temporary.push(wav);
      parts.push(wav);
      onProgress?.(index + 1, chunks.length);
    }
    // 接缝处只补一点很短的停顿（段落结尾稍长）
    const gaps = new Map();
    const gap = async (seconds) => {
      if (!gaps.has(seconds)) {
        const file = join(directory, `${id}-gap-${seconds}.wav`);
        await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", String(seconds), "-c:a", "pcm_s16le", file], 30000);
        temporary.push(file);
        gaps.set(seconds, file);
      }
      return gaps.get(seconds);
    };
    const list = [];
    for (const [index, wav] of parts.entries()) {
      list.push(wav);
      if (index < parts.length - 1) list.push(await gap(chunks[index].paragraphEnd ? 0.4 : 0.18));
    }
    const listFile = join(directory, `${id}-concat.txt`);
    temporary.push(listFile);
    await writeFile(listFile, list.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n"), "utf8");
    await run(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "pcm_s16le", output], 5 * 60 * 1000);
    return { fileName: `${id}.wav`, durationMs: await audioDuration(output), chunkCount: chunks.length };
  } finally {
    for (const file of temporary) await rm(file, { force: true });
    if (convertedPromptWav) await rm(convertedPromptWav, { force: true });
  }
}
