import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitVoiceText, generateVoice, audioDuration } from "../audio.mjs";
import { run, ffmpeg } from "../runtime.mjs";

const sentence = "这是一句用来测试分段的话，长度大约二十个字左右。";

test("short copy stays as one piece; long copy is split into roughly equal parts of at most about 800 characters", () => {
  assert.equal(splitVoiceText(sentence.repeat(10)).length, 1);
  const text = sentence.repeat(90);                      // 约 2000 字
  const chunks = splitVoiceText(text);
  assert.equal(chunks.length, 3);
  assert.equal(chunks.map((item) => item.text).join(""), text);
  const lengths = chunks.map((item) => item.text.length);
  assert.ok(Math.max(...lengths) - Math.min(...lengths) <= 60, lengths.join(","));
  assert.ok(lengths.every((length) => length <= 900));
  for (const chunk of chunks) assert.match(chunk.text, /[。！？]$/);
});

test("prefers to cut at a paragraph end near the target and never inside a sentence", () => {
  const paragraph = sentence.repeat(14);                 // 约 340 字一段
  const chunks = splitVoiceText([paragraph, paragraph, paragraph, paragraph].join("\n"));
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map((item) => item.text.length), [paragraph.length * 2, paragraph.length * 2]);
  assert.equal(chunks[0].paragraphEnd, true);
  assert.equal(chunks[1].paragraphEnd, false);
  assert.deepEqual(splitVoiceText("  \n "), []);
});

function wavBytes(seconds, sampleRate = 16000) {
  const samples = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i / 20) * 9000), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test("every chunk is generated from the same original reference and the pieces are stitched together", async (t) => {
  try { await run(ffmpeg, ["-version"], 5000); } catch { return t.skip("需要 FFmpeg"); }
  const directory = await mkdtemp(join(tmpdir(), "agent-storyboard-voice-"));
  const calls = [];
  const service = createServer(async (request, response) => {
    const chunks = [];
    for await (const part of request) chunks.push(part);
    const body = Buffer.concat(chunks);
    if (request.url === "/gradio_api/upload") {
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify(["/gradio/uploaded-reference.wav"]));
    }
    if (request.method === "POST" && request.url === "/gradio_api/call/generate") {
      calls.push(JSON.parse(body.toString()).data);
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify({ event_id: String(calls.length) }));
    }
    if (request.url.startsWith("/gradio_api/call/generate/")) {
      response.setHeader("content-type", "text/event-stream");
      const port = service.address().port;
      return response.end(`event: complete\ndata: ${JSON.stringify([{ url: `http://127.0.0.1:${port}/out.wav` }])}\n\n`);
    }
    if (request.url === "/out.wav") {
      response.setHeader("content-type", "audio/wav");
      return response.end(wavBytes(1));
    }
    response.statusCode = 404; response.end();
  });
  await new Promise((resolve) => service.listen(0, "127.0.0.1", resolve));
  process.env.AGENT_STORYBOARD_VOXCPM_URL = `http://127.0.0.1:${service.address().port}`;
  try {
    const reference = join(directory, "reference.wav");
    await writeFile(reference, wavBytes(2));
    const text = sentence.repeat(60) + "\n" + sentence.repeat(30);
    const progress = [];
    const result = await generateVoice({ directory, id: "take", text, instruction: "温柔女声", promptWav: reference, promptText: "参考音频原文", onProgress: (done, total) => progress.push([done, total]) });

    assert.equal(result.chunkCount, 3);
    assert.equal(calls.length, result.chunkCount);
    for (const data of calls) {
      assert.equal(data[1], "温柔女声");
      assert.equal(data[2].path, "/gradio/uploaded-reference.wav");   // 每段都用原始参考音频
      assert.equal(data[3], true);                                     // 带文本引导
      assert.equal(data[4], "参考音频原文");
    }
    assert.equal(calls.map((data) => data[0]).join(""), text.replace("\n", ""));
    assert.deepEqual(progress.at(-1), [result.chunkCount, result.chunkCount]);
    // 每段 1 秒，加上段间停顿，总时长应该明显大于纯拼接
    const seconds = (await audioDuration(join(directory, "take.wav"))) / 1000;
    assert.ok(seconds > result.chunkCount && seconds < result.chunkCount + 3, `duration ${seconds}`);
  } finally {
    delete process.env.AGENT_STORYBOARD_VOXCPM_URL;
    service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
