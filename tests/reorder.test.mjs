import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

test("reordering or deleting shots renames media files so regeneration cannot overwrite a neighbour", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-storyboard-reorder-"));
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ["server.mjs", "--port", String(port), "--data-dir", directory], { windowsHide: true });
  const stopped = new Promise(resolve => child.on("close", resolve));
  const request = async (path, method = "GET", body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const content = async (project, index) => (await fetch(`http://127.0.0.1:${port}${project.shots[index].mediaUrl}`)).text();
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await request("/api/health")).status === 200) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    let { data: project } = await request("/api/projects", "POST", {
      title: "Reorder",
      shots: [{ rollType: "A-ROLL" }, { rollType: "B-ROLL" }, { rollType: "A-ROLL" }]
    });
    for (const [index, shot] of project.shots.entries()) {
      const source = join(directory, `source-${index}.png`);
      await writeFile(source, `content-of-shot-${index}`);
      project = (await request(`/api/projects/${project.id}/shots/${shot.id}/media`, "POST", { sourcePath: source, mediaType: "image" })).data;
    }
    const [a, b, c] = project.shots.map(shot => shot.id);
    assert.deepEqual(await Promise.all([0, 1, 2].map(i => content(project, i))), ["content-of-shot-0", "content-of-shot-1", "content-of-shot-2"]);

    // 交换 1、2 号镜头：内容必须跟着镜头走，文件名序号跟着新顺序走。
    project = (await request(`/api/projects/${project.id}`, "PUT", { ...project, shots: [project.shots[1], project.shots[0], project.shots[2]] })).data;
    assert.deepEqual(project.shots.map(shot => shot.id), [b, a, c]);
    assert.deepEqual(await Promise.all([0, 1, 2].map(i => content(project, i))), ["content-of-shot-1", "content-of-shot-0", "content-of-shot-2"]);
    project.shots.forEach((shot, i) => assert.match(decodeURIComponent(shot.mediaUrl), new RegExp(`shot-00${i + 1}-`)));
    assert.equal(new Set(project.shots.map(shot => shot.mediaUrl)).size, 3);

    // 删除第一个镜头：其余镜头的文件顺延，不留重名。
    project = (await request(`/api/projects/${project.id}`, "PUT", { ...project, shots: project.shots.slice(1) })).data;
    assert.deepEqual(project.shots.map(shot => shot.id), [a, c]);
    assert.deepEqual(await Promise.all([0, 1].map(i => content(project, i))), ["content-of-shot-0", "content-of-shot-2"]);
    const files = (await readdir(join(directory, "projects", project.id, "media"))).filter(name => name.startsWith("shot-") || name.startsWith(".moving"));
    assert.deepEqual(files.sort(), project.shots.map(shot => decodeURIComponent(shot.mediaUrl.split("/").pop())).sort());
    assert.equal(JSON.parse(await readFile(join(directory, "projects", project.id, "project.json"), "utf8")).shots.length, 2);
  } finally {
    child.kill();
    await stopped;
    await rm(directory, { recursive: true, force: true });
  }
});
