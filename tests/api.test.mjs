import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
test("project persistence, conflict detection, generation cancellation and recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-storyboard-test-"));
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ["server.mjs", "--port", String(port), "--data-dir", directory], { windowsHide: true, env: { ...process.env, AGENT_STORYBOARD_VOXCPM_URL: "http://127.0.0.1:1" } });
  const stopped = new Promise(resolve => child.on("close", resolve));
  let log = ""; child.stderr.on("data", d => { log += d; });
  child.stdout.on("data", d => { log += d; });
  const request = async (path, method = "GET", body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await request("/api/health")).status === 200) break; } catch {}
      if (i === 99) throw Error(log);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    let { data: project } = await request("/api/projects", "POST", { title: "Integration", shots: [{ dialogue: "hello", visualPrompt: "rain", generator: "image-gen" }] });
    const path = `/api/projects/${project.id}`;
    const original = structuredClone(project);
    project.scriptDraft = "persistent draft";
    project = (await request(path, "PUT", project)).data;
    assert.equal((await request(path)).data.scriptDraft, "persistent draft");
    assert.equal((await request(path, "PUT", original)).status, 409);
    let queued = (await request("/api/generation/tasks", "POST", { projectId: project.id, shotIds: [project.shots[0].id] })).data;
    let task = queued.queued[0].taskId;
    assert.equal((await request(`/api/generation/tasks/${task}/claim`, "POST", {})).status, 200);
    assert.equal((await request(`/api/generation/tasks/${task}/heartbeat`, "POST", {})).status, 200);
    assert.equal((await request(`/api/generation/tasks/${task}/cancel`, "POST", {})).status, 200);
    assert.equal((await request(`/api/generation/tasks/${task}/complete`, "POST", { sourcePath: "missing.png" })).status, 404);
    queued = (await request("/api/generation/tasks", "POST", { projectId: project.id, shotIds: [project.shots[0].id] })).data;
    task = queued.queued[0].taskId;
    await request(`/api/generation/tasks/${task}/claim`, "POST", {});
    const file = join(directory, "projects", project.id, "project.json");
    const stored = JSON.parse(await readFile(file, "utf8"));
    stored.shots[0].generationHeartbeatAt = "2020-01-01T00:00:00Z";
    stored.audio = { takes: [], status: "generating" };
    await writeFile(file, JSON.stringify(stored));
    const recovered = (await request(path)).data;
    assert.equal(recovered.audio.status, "failed");
    assert.equal((await request(path)).data.shots[0].generationStatus, "failed");
    assert.equal((await request(`/api/generation/tasks/${task}/complete`, "POST", { sourcePath: "missing.png" })).status, 409);
    const referenceBytes = Buffer.from("RIFF-codex-reference");
    const referenceForm = new FormData();
    referenceForm.append("file", new Blob([referenceBytes], { type: "audio/wav" }), "reference.wav");
    const referenceResponse = await fetch(`http://127.0.0.1:${port}${path}/audio/reference`, { method: "POST", body: referenceForm });
    assert.equal(referenceResponse.status, 200);
    const referenceProject = await referenceResponse.json();
    assert.equal(referenceProject.audio.reference.fileName, "voice-reference.wav");
    const referenceMedia = await fetch(`http://127.0.0.1:${port}${referenceProject.audio.reference.url}`);
    assert.equal(referenceMedia.headers.get("content-length"), String(referenceBytes.length));
    assert.deepEqual(Buffer.from(await referenceMedia.arrayBuffer()), referenceBytes);
    const rangedMedia = await fetch(`http://127.0.0.1:${port}${referenceProject.audio.reference.url}`, { headers: { range: "bytes=2-5" } });
    assert.equal(rangedMedia.status, 206);
    assert.equal(rangedMedia.headers.get("accept-ranges"), "bytes");
    assert.equal(rangedMedia.headers.get("content-range"), `bytes 2-5/${referenceBytes.length}`);
    assert.equal(rangedMedia.headers.get("content-length"), "4");
    assert.deepEqual(Buffer.from(await rangedMedia.arrayBuffer()), referenceBytes.subarray(2, 6));
    const m4aBytes = Buffer.from("M4A-codex-reference");
    const m4aForm = new FormData();
    m4aForm.append("file", new Blob([m4aBytes], { type: "audio/mp4" }), "reference.m4a");
    const m4aResponse = await fetch(`http://127.0.0.1:${port}${path}/audio/reference`, { method: "POST", body: m4aForm });
    assert.equal(m4aResponse.status, 200);
    const m4aProject = await m4aResponse.json();
    assert.equal(m4aProject.audio.reference.fileName, "voice-reference.m4a");
    const m4aMedia = await fetch(`http://127.0.0.1:${port}${m4aProject.audio.reference.url}`);
    assert.equal(m4aMedia.headers.get("content-type"), "audio/mp4");
    assert.deepEqual(Buffer.from(await m4aMedia.arrayBuffer()), m4aBytes);
    assert.equal((await request(`${path}/audio/generate`, "POST", { instruction: "test" })).status, 202);
    let audio;
    for (let i = 0; i < 50; i++) {
      audio = (await request(path)).data.audio;
      if (audio.status === "failed") break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(audio.status, "failed");
    assert.ok(audio.error);
    const blocked = await fetch(`http://127.0.0.1:${port}${path}/audio/generate`, { method: "POST", headers: { origin: "https://untrusted.example", "content-type": "application/json" }, body: "{}" });
    assert.equal(blocked.status, 403);
    const scriptOnly = JSON.parse(await readFile(file, "utf8"));
    scriptOnly.shots = [];
    scriptOnly.scriptDraft = "hello";
    scriptOnly.audio = { takes: [{ id: "take-script", fileName: "take.wav", text: "hello", durationMs: 1000 }], selectedId: "take-script", status: "ready" };
    await writeFile(file, JSON.stringify(scriptOnly));
    const scriptOnlyAlign = await request(`${path}/audio/align`, "POST", {});
    assert.equal(scriptOnlyAlign.status, 409);
    assert.equal(scriptOnlyAlign.data.error, "当前项目没有带台词的镜头，无法进行对齐");
  } finally {
    child.kill(); await stopped;
    await rm(directory, { recursive: true, force: true });
  }
});
