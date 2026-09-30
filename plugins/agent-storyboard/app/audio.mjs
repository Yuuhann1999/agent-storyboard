import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
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

export async function generateVoice({ directory, id, text, instruction, promptWav, promptText }) {
  const raw = join(directory, `${id}-raw.wav`);
  const output = join(directory, `${id}.wav`);
  let convertedPromptWav = null;
  try {
    await verifyVoiceRuntime();
    let promptForVoice = promptWav;
    if (promptWav && extname(String(promptWav)).toLowerCase() !== ".wav") {
      convertedPromptWav = join(directory, `${id}-prompt.wav`);
      await run(ffmpeg, ["-y", "-i", String(promptWav), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", convertedPromptWav], 60000);
      promptForVoice = convertedPromptWav;
    }
    await generateVoxcpm({ text, output: raw, instruction, promptWav: promptForVoice ? String(promptForVoice) : "", promptText: String(promptText || "") });
    await run(ffmpeg, ["-y", "-i", raw, "-ar", "48000", "-ac", "1", output], 60000);
    return { fileName: `${id}.wav`, durationMs: await audioDuration(output) };
  } finally {
    await rm(raw, { force: true });
    if (convertedPromptWav) await rm(convertedPromptWav, { force: true });
  }
}
