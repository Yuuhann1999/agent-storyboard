import { createServer } from "node:http";
import { expireTasks } from "./task-state.mjs";
import { inspectEnvironment } from "./runtime.mjs";
import { generateVoice, alignVoice } from "./audio.mjs";
import { spokenText, dialogueKey, applyTiming, voiceTextsMatch } from "./timing.mjs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const args = parseArgs(process.argv.slice(2));
const publicDir = resolve(args.publicDir || process.env.CODEX_STORYBOARD_PUBLIC_DIR || join(rootDir, "public"));
const dataDir = resolve(
  args.dataDir ||
  process.env.CODEX_STORYBOARD_DATA_DIR ||
  process.env.CODEX_STORYBOARD_HOME ||
  join(homedir(), ".codex-storyboard")
);
const projectsDir = join(dataDir, "projects");
const projectsFile = join(dataDir, "projects.json");
const legacyDataFile = join(dataDir, "storyboard.json");
const legacyMediaDir = join(dataDir, "media");
const port = Number(args.port || process.env.PORT || process.env.CODEX_STORYBOARD_PORT || 43218);
let generationMutationQueue = Promise.resolve();
let apiQueue = Promise.resolve();
const audioJobs = new Set();
function serializeApi(operation) {
  const result = apiQueue.then(operation, operation);
  apiQueue = result.catch(() => {});
  return result;
}
async function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

const aspectRatios = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "3:4": { width: 1080, height: 1440 },
  "4:3": { width: 1440, height: 1080 },
  "1:1": { width: 1080, height: 1080 }
};

const contentTypes = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime"
};

const allowedUploads = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["video/mp4", ".mp4"],
  ["video/webm", ".webm"],
  ["video/quicktime", ".mov"]
]);

const allowedAudioUploads = new Map([
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["audio/wave", ".wav"],
  ["audio/mpeg", ".mp3"],
  ["audio/mp3", ".mp3"],
  ["audio/mp4", ".m4a"],
  ["audio/x-m4a", ".m4a"],
  ["audio/m4a", ".m4a"]
]);

const coverRatios = {
  vertical: { label: "竖屏", aspectRatio: "9:16", width: 1080, height: 1920 },
  horizontal: { label: "横屏", aspectRatio: "16:9", width: 1920, height: 1080 }
};

const docxImageTypes = new Map([
  [".png", { extension: "png", contentType: "image/png" }],
  [".jpg", { extension: "jpg", contentType: "image/jpeg" }],
  [".jpeg", { extension: "jpg", contentType: "image/jpeg" }],
  [".gif", { extension: "gif", contentType: "image/gif" }],
  [".bmp", { extension: "bmp", contentType: "image/bmp" }]
]);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--port") parsed.port = argv[++index];
    else if (value.startsWith("--port=")) parsed.port = value.slice("--port=".length);
    else if (value === "--data-dir") parsed.dataDir = argv[++index];
    else if (value.startsWith("--data-dir=")) parsed.dataDir = value.slice("--data-dir=".length);
    else if (value === "--public-dir") parsed.publicDir = argv[++index];
    else if (value.startsWith("--public-dir=")) parsed.publicDir = value.slice("--public-dir=".length);
  }
  return parsed;
}

await mkdir(projectsDir, { recursive: true });
await migrateLegacyProject();

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(value));
  return true;
}

function sendError(response, status, message) {
  return sendJson(response, status, { error: message });
}

async function readBodyBuffer(request, limit = 100 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("上传文件不能超过 100MB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(request) {
  const buffer = await readBodyBuffer(request, 5 * 1024 * 1024);
  if (buffer.length === 0) return {};
  return JSON.parse(buffer.toString("utf8"));
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function safeId(value) {
  return /^[a-zA-Z0-9_-]+$/.test(value);
}

function projectVoiceText(project) {
  return spokenText(project.shots) || project.scriptDraft.trim();
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createTaskId() {
  return createId("task");
}

function normalizeAspectRatio(value) {
  return aspectRatios[value] ? value : "16:9";
}

function normalizeShot(shot = {}) {
  const generationStatus = ["idle", "pending", "processing", "ready", "failed"].includes(
    shot.generationStatus
  )
    ? shot.generationStatus
    : shot.mediaUrl
      ? "ready"
      : "idle";

  return {
    id: shot.id || createId("shot"),
    rollType: shot.rollType === "A-ROLL" ? "A-ROLL" : "B-ROLL",
    mediaType: shot.mediaType === "video" ? "video" : "image",
    duration: Number.isFinite(Number(shot.duration)) ? Number(shot.duration) : 5,
    dialogue: String(shot.dialogue || ""),
    timeStart: Number.isFinite(shot.timeStart) ? shot.timeStart : null,
    timeEnd: Number.isFinite(shot.timeEnd) ? shot.timeEnd : null,
    visualPrompt: String(shot.visualPrompt || ""),
    generator: ["manual", "image-gen", "hyperframes", "remotion"].includes(shot.generator)
      ? shot.generator
      : "manual",
    mediaUrl: String(shot.mediaUrl || ""),
    notes: String(shot.notes || ""),
    generationStatus,
    generationTaskId: String(shot.generationTaskId || ""),
    generationError: String(shot.generationError || ""),
    generationRequestedAt: shot.generationRequestedAt || null,
    generationStartedAt: shot.generationStartedAt || null,
    generationHeartbeatAt: shot.generationHeartbeatAt || null,
    generationCompletedAt: shot.generationCompletedAt || null
  };
}

function normalizeCover(cover = {}, type = "vertical") {
  const generationStatus = ["idle", "pending", "processing", "ready", "failed"].includes(
    cover.generationStatus
  )
    ? cover.generationStatus
    : cover.mediaUrl
      ? "ready"
      : "idle";

  return {
    type,
    preset: String(cover.preset || "custom"),
    title: String(cover.title || ""),
    prompt: String(cover.prompt || ""),
    referenceUrl: String(cover.referenceUrl || ""),
    mediaUrl: String(cover.mediaUrl || ""),
    generationStatus,
    generationTaskId: String(cover.generationTaskId || ""),
    generationError: String(cover.generationError || ""),
    generationRequestedAt: cover.generationRequestedAt || null,
    generationStartedAt: cover.generationStartedAt || null,
    generationHeartbeatAt: cover.generationHeartbeatAt || null,
    generationCompletedAt: cover.generationCompletedAt || null
  };
}

function normalizeCovers(covers = {}) {
  return {
    vertical: normalizeCover(covers.vertical, "vertical"),
    horizontal: normalizeCover(covers.horizontal, "horizontal")
  };
}

function normalizeProject(project = {}) {
  const now = new Date().toISOString();
  return {
    id: String(project.id || createId("project")),
    title: String(project.title || "未命名项目").trim() || "未命名项目",
    aspectRatio: normalizeAspectRatio(project.aspectRatio),
    scriptDraft: String(project.scriptDraft || ""),
    audio: project.audio && typeof project.audio === "object" ? project.audio : { takes: [], selectedId: "", status: "idle" },
    hasDesign: Boolean(project.hasDesign),
    covers: normalizeCovers(project.covers),
    shots: Array.isArray(project.shots) ? project.shots.map(normalizeShot) : [],
    createdAt: project.createdAt || now,
    updatedAt: project.updatedAt || now
  };
}

function projectDir(projectId) {
  return join(projectsDir, projectId);
}

function projectFile(projectId) {
  return join(projectDir(projectId), "project.json");
}

function projectMediaDir(projectId) {
  return join(projectDir(projectId), "media");
}

function projectDesignFile(projectId) {
  return join(projectDir(projectId), "DESIGN.md");
}

async function readProjectsIndex() {
  return JSON.parse(await readFile(projectsFile, "utf8"));
}

async function saveProjectsIndex(index) {
  await atomicJson(projectsFile, index);
  return index;
}

async function readProject(projectId) {
  if (!safeId(projectId)) throw Object.assign(new Error("Project not found"), { status: 404 });
  try {
    const project = normalizeProject(JSON.parse(await readFile(projectFile(projectId), "utf8")));
    project.hasDesign = await exists(projectDesignFile(projectId));
    if (["generating", "aligning"].includes(project.audio.status) && !audioJobs.has(projectId)) {
      project.audio.status = "failed";
      project.audio.error = "上次配音任务已中断，请重试";
      return saveProject(project);
    }
    if (expireTasks(project)) return saveProject(project);
    return project;
  } catch (error) {
    if (error.code === "ENOENT") throw Object.assign(new Error("Project not found"), { status: 404 });
    throw error;
  }
}

async function saveProject(project) {
  const next = normalizeProject({ ...project, updatedAt: new Date(Math.max(Date.now(), Date.parse(project.updatedAt || 0) + 1 || 0)).toISOString() });
  await mkdir(projectMediaDir(next.id), { recursive: true });
  next.hasDesign = await exists(projectDesignFile(next.id));
  await atomicJson(projectFile(next.id), next);

  const index = await readProjectsIndex();
  const record = {
    id: next.id,
    title: next.title,
    aspectRatio: next.aspectRatio,
    hasDesign: next.hasDesign,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt
  };
  const existing = index.projects.findIndex((item) => item.id === next.id);
  if (existing >= 0) index.projects[existing] = record;
  else index.projects.unshift(record);
  await saveProjectsIndex(index);
  return next;
}

function mediaUrl(projectId, fileName) {
  return `/media/${encodeURIComponent(projectId)}/${encodeURIComponent(fileName)}`;
}

function mediaFileNameFromUrl(url) {
  const parts = String(url).split("/");
  return decodeURIComponent(parts.at(-1) || "");
}

function safeDownloadFileName(value) {
  return String(value || "codex-storyboard")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "codex-storyboard";
}

function shotMediaFileName(project, shot, extension) {
  const index = project.shots.findIndex((item) => item.id === shot.id) + 1;
  const order = String(Math.max(index, 1)).padStart(3, "0");
  const roll = shot.rollType === "A-ROLL" ? "A-ROLL" : "B-ROLL";
  const mediaType = shot.mediaType === "video" ? "video" : "image";
  return `shot-${order}-${roll}-${mediaType}${extension}`;
}

function coverMediaFileName(type, extension) {
  return `cover-${type === "horizontal" ? "horizontal" : "vertical"}${extension}`;
}

function coverReferenceFileName(type, extension) {
  return `cover-${type === "horizontal" ? "horizontal" : "vertical"}-reference${extension}`;
}

function audioReferenceFileName(extension) {
  return `voice-reference${extension}`;
}

async function removeCurrentMedia(project, mediaUrlValue) {
  if (!mediaUrlValue) return;
  const fileName = basename(mediaFileNameFromUrl(mediaUrlValue));
  if (!fileName) return;
  await rm(join(projectMediaDir(project.id), fileName), { force: true });
}

async function openLocalFolder(folderPath) {
  await mkdir(folderPath, { recursive: true });
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "explorer"
      : "xdg-open";
  const child = spawn(command, [folderPath], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

async function projectSummary(record) {
  const project = await readProject(record.id);
  const duration = project.shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
  const cover =
    project.covers.horizontal.mediaUrl ||
    project.covers.vertical.mediaUrl ||
    project.shots.find((shot) => shot.mediaUrl)?.mediaUrl ||
    "";
  return {
    ...record,
    shotCount: project.shots.length,
    duration,
    coverUrl: cover,
    hasDesign: project.hasDesign
  };
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function docxRunXml(text, options = {}) {
  const bold = options.bold ? "<w:b/><w:bCs/>" : "";
  return `<w:r><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:cs="Microsoft YaHei"/>${bold}<w:color w:val="${options.color || "222222"}"/><w:sz w:val="${options.size || 18}"/><w:szCs w:val="${options.size || 18}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function docxParagraphXml(text, options = {}) {
  const value = String(text || "").replace(/\s+/g, " ").trim() || options.fallback || "无";
  const alignment = options.alignment || "left";
  return `<w:p><w:pPr><w:spacing w:before="${options.before || 0}" w:after="${options.after || 80}"/><w:jc w:val="${alignment}"/></w:pPr>${docxRunXml(value, options)}</w:p>`;
}

function docxParagraphsXml(text, options = {}) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines.length ? lines : [options.fallback || "无"]).map((line) => docxParagraphXml(line, options));
}

function docxCellXml(paragraphs, width, fill = "FFFFFF") {
  return `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${width}"/><w:tcBorders><w:top w:val="single" w:color="D9DEE7" w:sz="1"/><w:left w:val="single" w:color="D9DEE7" w:sz="1"/><w:bottom w:val="single" w:color="D9DEE7" w:sz="1"/><w:right w:val="single" w:color="D9DEE7" w:sz="1"/></w:tcBorders><w:shd w:fill="${fill}" w:val="clear"/><w:tcMar><w:top w:type="dxa" w:w="120"/><w:left w:type="dxa" w:w="120"/><w:bottom w:type="dxa" w:w="120"/><w:right w:type="dxa" w:w="120"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr>${paragraphs.join("")}</w:tc>`;
}

function docxHeaderCellXml(text, width) {
  return docxCellXml([
    docxParagraphXml(text, { alignment: "center", bold: true, size: 18, color: "111827" })
  ], width, "EAF1F8");
}

function docxPreviewSize(aspectRatio) {
  const ratio = aspectRatios[aspectRatio] || aspectRatios["16:9"];
  const maxWidth = 250;
  const maxHeight = 141;
  const scale = Math.min(maxWidth / ratio.width, maxHeight / ratio.height);
  return {
    width: Math.max(70, Math.round(ratio.width * scale)),
    height: Math.max(70, Math.round(ratio.height * scale))
  };
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZip(files) {
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034B50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    chunks.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014B50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralDirectory.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  }

  const centralDirectorySize = centralDirectory.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectorySize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...centralDirectory, end]);
}

function docxImageParagraphXml(image) {
  const cx = image.width * 9525;
  const cy = image.height * 9525;
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent t="0" r="0" b="0" l="0"/><wp:docPr id="${image.id}" name="${xmlEscape(image.name)}" descr="${xmlEscape(image.description)}" title="${xmlEscape(image.title)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${xmlEscape(image.name)}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1" noChangeArrowheads="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${image.relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

async function docxMediaParagraphsXml(project, shot, shotNumber, mediaFiles) {
  if (!shot.mediaUrl) return [docxParagraphXml("未上传素材", { color: "777777" })];

  const fileName = basename(mediaFileNameFromUrl(shot.mediaUrl));
  const mediaPath = join(projectMediaDir(project.id), fileName);
  if (!(await exists(mediaPath))) return [docxParagraphXml("素材文件未找到", { color: "B42318" })];

  if (shot.mediaType === "video") {
    return [
      docxParagraphXml("视频素材", { alignment: "center", color: "4B5563", bold: true }),
      docxParagraphXml(fileName, { alignment: "center", color: "4B5563", size: 16 })
    ];
  }

  const imageType = docxImageTypes.get(extname(mediaPath).toLowerCase());
  if (!imageType) {
    return [
      docxParagraphXml("图片格式暂不支持", { alignment: "center", color: "B42318" }),
      docxParagraphXml(fileName, { alignment: "center", color: "B42318", size: 16 })
    ];
  }

  const size = docxPreviewSize(project.aspectRatio);
  const mediaIndex = mediaFiles.length + 1;
  const wordFileName = `image${mediaIndex}.${imageType.extension}`;
  const relationshipId = `rId${mediaIndex}`;
  mediaFiles.push({
    path: `word/media/${wordFileName}`,
    data: await readFile(mediaPath),
    relationshipId,
    contentType: imageType.contentType
  });
  return [
    docxImageParagraphXml({
      id: mediaIndex,
      relationshipId,
      name: wordFileName,
      title: `镜头 ${shotNumber} 素材预览`,
      description: shot.visualPrompt || "",
      width: size.width,
      height: size.height
    })
  ];
}

async function buildProjectDocx(project) {
  const tableWidth = 15398;
  const columnWidths = [1200, 3900, 3600, 4100, 2598];
  const duration = project.shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
  const mediaFiles = [];
  const rows = [
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>${[
      docxHeaderCellXml("镜头", columnWidths[0]),
      docxHeaderCellXml("素材预览", columnWidths[1]),
      docxHeaderCellXml("口播文案", columnWidths[2]),
      docxHeaderCellXml("画面说明", columnWidths[3]),
      docxHeaderCellXml("备注", columnWidths[4])
    ].join("")}</w:tr>`
  ];

  for (const [index, shot] of project.shots.entries()) {
    const shotNumber = index + 1;
    rows.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${[
      docxCellXml([
        docxParagraphXml(String(shotNumber).padStart(2, "0"), { alignment: "center", bold: true }),
        docxParagraphXml(shot.rollType || "B-ROLL", { alignment: "center", bold: true }),
        docxParagraphXml(`${Number(shot.duration || 0)}s`, { alignment: "center", bold: true })
      ], columnWidths[0], "F8FAFC"),
      docxCellXml(await docxMediaParagraphsXml(project, shot, shotNumber, mediaFiles), columnWidths[1]),
      docxCellXml(docxParagraphsXml(shot.dialogue, { size: 19 }), columnWidths[2]),
      docxCellXml(docxParagraphsXml(shot.visualPrompt, { size: 18 }), columnWidths[3]),
      docxCellXml(docxParagraphsXml(shot.notes, { size: 17, color: "374151" }), columnWidths[4])
    ].join("")}</w:tr>`);
  }

  const children = [
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:after="120"/></w:pPr>${docxRunXml(project.title, { bold: true, size: 30, color: "111827" })}</w:p>`,
    docxParagraphXml(
      `项目 ID：${project.id}    画幅：${project.aspectRatio}    镜头数：${project.shots.length}    总时长：${formatDuration(duration)}`,
      { size: 18, color: "4B5563", after: 180 }
    )
  ];

  if (project.shots.length > 0) {
    children.push(`<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="${tableWidth}"/><w:tblBorders><w:top w:val="single" w:color="auto" w:sz="4"/><w:left w:val="single" w:color="auto" w:sz="4"/><w:bottom w:val="single" w:color="auto" w:sz="4"/><w:right w:val="single" w:color="auto" w:sz="4"/><w:insideH w:val="single" w:color="auto" w:sz="4"/><w:insideV w:val="single" w:color="auto" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${columnWidths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl>`);
  } else {
    children.push(docxParagraphXml("当前项目暂无镜头。", { color: "777777" }));
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 w15 wp14"><w:body>${children.join("")}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="708" w:footer="708" w:gutter="0"/><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>`;

  const contentTypes = new Map(mediaFiles.map((file) => [file.path.split(".").pop(), file.contentType]));
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...contentTypes].map(([extension, contentType]) => `<Default Extension="${extension}" ContentType="${contentType}"/>`).join("")}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const documentRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${mediaFiles.map((file) => `<Relationship Id="${file.relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${file.path.split("/").pop()}"/>`).join("")}</Relationships>`;

  return createZip([
    { path: "[Content_Types].xml", data: Buffer.from(contentTypesXml, "utf8") },
    { path: "_rels/.rels", data: Buffer.from(rootRelsXml, "utf8") },
    { path: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
    { path: "word/_rels/document.xml.rels", data: Buffer.from(documentRelsXml, "utf8") },
    ...mediaFiles
  ]);
}

function sendDocx(response, fileName, buffer) {
  const encodedName = encodeURIComponent(fileName);
  response.writeHead(200, {
    "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "content-disposition": `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`,
    "content-length": buffer.length,
    "cache-control": "no-store"
  });
  response.end(buffer);
  return true;
}

function generationTask(project, item, type = "shot") {
  const isCover = type === "cover";
  const coverSpec = isCover ? coverRatios[item.type] || coverRatios.vertical : null;
  const dimensions = isCover ? coverSpec : aspectRatios[project.aspectRatio];
  const taskOutputDir = resolve(dataDir, "generation", project.id, item.generationTaskId);
  const shotIndex = isCover ? 0 : project.shots.findIndex((shot) => shot.id === item.id) + 1;
  const referenceFileName = isCover && item.referenceUrl
    ? basename(decodeURIComponent(String(item.referenceUrl).split("/").pop() || ""))
    : "";
  return {
    taskId: item.generationTaskId,
    taskType: type,
    projectId: project.id,
    projectTitle: project.title,
    aspectRatio: isCover ? coverSpec.aspectRatio : project.aspectRatio,
    width: dimensions.width,
    height: dimensions.height,
    hasDesign: project.hasDesign,
    designPath: project.hasDesign ? resolve(projectDesignFile(project.id)) : null,
    outputDir: taskOutputDir,
    shotId: isCover ? null : item.id,
    shotIndex,
    coverType: isCover ? item.type : null,
    coverTitle: isCover ? item.title : null,
    coverPreset: isCover ? item.preset : null,
    referenceImageUrl: isCover ? item.referenceUrl || "" : "",
    referenceImagePath: referenceFileName
      ? join(projectMediaDir(project.id), referenceFileName)
      : null,
    status: item.generationStatus,
    generator: isCover ? "image-gen" : item.generator,
    mediaType: isCover ? "image" : item.mediaType,
    rollType: isCover ? null : item.rollType,
    duration: isCover ? 0 : item.duration,
    dialogue: isCover ? item.title : item.dialogue,
    visualPrompt: isCover ? item.prompt : item.visualPrompt,
    notes: isCover ? "短视频封面" : item.notes,
    requestedAt: item.generationRequestedAt,
    startedAt: item.generationStartedAt,
    completedAt: item.generationCompletedAt,
    error: item.generationError
  };
}

async function attachMedia(project, shot, sourcePath, mediaType) {
  const resolvedSource = resolve(String(sourcePath));
  await stat(resolvedSource);
  const extension = extname(resolvedSource).toLowerCase();
  const fileName = shotMediaFileName(project, shot, extension);
  await removeCurrentMedia(project, shot.mediaUrl);
  await copyFile(resolvedSource, join(projectMediaDir(project.id), fileName));
  shot.mediaUrl = mediaUrl(project.id, fileName);
  if (mediaType === "image" || mediaType === "video") shot.mediaType = mediaType;
  shot.generationStatus = "ready";
  shot.generationError = "";
  shot.generationCompletedAt = new Date().toISOString();
}

async function attachCoverMedia(project, cover, sourcePath) {
  const resolvedSource = resolve(String(sourcePath));
  await stat(resolvedSource);
  const extension = extname(resolvedSource).toLowerCase();
  const fileName = coverMediaFileName(cover.type, extension);
  await removeCurrentMedia(project, cover.mediaUrl);
  await copyFile(resolvedSource, join(projectMediaDir(project.id), fileName));
  cover.mediaUrl = mediaUrl(project.id, fileName);
  cover.generationStatus = "ready";
  cover.generationError = "";
  cover.generationCompletedAt = new Date().toISOString();
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error("缺少上传边界");
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
  let cursor = 0;

  while (cursor < buffer.length) {
    const boundaryStart = buffer.indexOf(boundary, cursor);
    if (boundaryStart < 0) break;
    const partStart = boundaryStart + boundary.length + 2;
    const headerEnd = buffer.indexOf(headerSeparator, partStart);
    if (headerEnd < 0) break;
    const headers = buffer.subarray(partStart, headerEnd).toString("utf8");
    const nextBoundary = buffer.indexOf(boundary, headerEnd + headerSeparator.length);
    if (nextBoundary < 0) break;
    const content = buffer.subarray(headerEnd + headerSeparator.length, nextBoundary - 2);
    const name = headers.match(/name="([^"]+)"/i)?.[1];
    const filename = headers.match(/filename="([^"]*)"/i)?.[1];
    const mimeType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim();
    if (name === "file" && filename) return { filename, mimeType, content };
    cursor = nextBoundary;
  }
  throw new Error("没有找到上传文件");
}

async function saveUploadedMedia(project, shot, request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.startsWith("multipart/form-data")) throw new Error("需要 multipart/form-data");
  const file = parseMultipart(await readBodyBuffer(request), contentType);
  const extension = allowedUploads.get(file.mimeType);
  if (!extension) throw new Error("仅支持 PNG、JPEG、WebP、GIF、MP4、WebM 和 MOV");

  const mediaType = file.mimeType.startsWith("video/") ? "video" : "image";
  shot.mediaType = mediaType;
  const fileName = shotMediaFileName(project, shot, extension);
  await removeCurrentMedia(project, shot.mediaUrl);
  await writeFile(join(projectMediaDir(project.id), fileName), file.content);
  shot.mediaUrl = mediaUrl(project.id, fileName);
  shot.generationStatus = "ready";
  shot.generationTaskId = "";
  shot.generationError = "";
  shot.generationCompletedAt = new Date().toISOString();
}

async function saveUploadedCover(project, cover, request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.startsWith("multipart/form-data")) throw new Error("需要 multipart/form-data");
  const file = parseMultipart(await readBodyBuffer(request), contentType);
  const extension = allowedUploads.get(file.mimeType);
  if (!extension || !file.mimeType.startsWith("image/")) {
    throw new Error("封面仅支持 PNG、JPEG、WebP 和 GIF");
  }

  const fileName = coverMediaFileName(cover.type, extension);
  await removeCurrentMedia(project, cover.mediaUrl);
  await writeFile(join(projectMediaDir(project.id), fileName), file.content);
  cover.mediaUrl = mediaUrl(project.id, fileName);
  cover.generationStatus = "ready";
  cover.generationTaskId = "";
  cover.generationError = "";
  cover.generationCompletedAt = new Date().toISOString();
}

async function saveUploadedCoverReference(project, cover, request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.startsWith("multipart/form-data")) throw new Error("需要 multipart/form-data");
  const file = parseMultipart(await readBodyBuffer(request), contentType);
  const extension = allowedUploads.get(file.mimeType);
  if (!extension || !file.mimeType.startsWith("image/")) {
    throw new Error("参考图仅支持 PNG、JPEG、WebP 和 GIF");
  }

  const fileName = coverReferenceFileName(cover.type, extension);
  await removeCurrentMedia(project, cover.referenceUrl);
  await writeFile(join(projectMediaDir(project.id), fileName), file.content);
  cover.referenceUrl = mediaUrl(project.id, fileName);
}

async function saveUploadedAudioReference(project, request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.startsWith("multipart/form-data")) throw new Error("需要 multipart/form-data");
  const file = parseMultipart(await readBodyBuffer(request), contentType);
  const mimeType = String(file.mimeType || "").split(";", 1)[0].trim().toLowerCase();
  const extension = allowedAudioUploads.get(mimeType);
  if (!extension) throw new Error("参考音频仅支持 WAV、MP3 或 M4A");

  const audio = project.audio && typeof project.audio === "object"
    ? project.audio
    : { takes: [], selectedId: "", status: "idle" };
  const fileName = audioReferenceFileName(extension);
  await removeCurrentMedia(project, audio.reference?.url);
  await writeFile(join(projectMediaDir(project.id), fileName), file.content);
  audio.reference = {
    fileName,
    url: mediaUrl(project.id, fileName),
    text: String(audio.reference?.text || "")
  };
  project.audio = audio;
}

async function removeAudioReference(project) {
  const reference = project.audio?.reference;
  if (reference?.url) await removeCurrentMedia(project, reference.url);
  project.audio.reference = null;
}

async function saveUploadedDesign(project, request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.startsWith("multipart/form-data")) throw new Error("需要 multipart/form-data");
  const file = parseMultipart(await readBodyBuffer(request, 2 * 1024 * 1024), contentType);
  if (extname(file.filename).toLowerCase() !== ".md") throw new Error("仅支持 Markdown 文件");

  const content = file.content.toString("utf8").replace(/^\uFEFF/, "");
  if (!content.trim()) throw new Error("DESIGN.md 不能为空");
  if (content.includes("\u0000")) throw new Error("DESIGN.md 必须是 UTF-8 文本");

  await writeFile(projectDesignFile(project.id), content, "utf8");
  project.hasDesign = true;
}

async function findTask(taskId) {
  const index = await readProjectsIndex();
  for (const record of index.projects) {
    const project = await readProject(record.id);
    const shot = project.shots.find((item) => item.generationTaskId === taskId);
    if (shot) return { project, item: shot, taskType: "shot" };
    for (const cover of Object.values(project.covers)) {
      if (cover.generationTaskId === taskId) return { project, item: cover, taskType: "cover" };
    }
  }
  return null;
}

function mutateGenerationTask(callback) {
  const mutation = generationMutationQueue.then(callback, callback);
  generationMutationQueue = mutation.catch(() => {});
  return mutation;
}

async function migrateLegacyProject() {
  if (await exists(projectsFile)) return;
  if (!(await exists(legacyDataFile))) {
    await saveProjectsIndex({ projects: [] });
    return;
  }

  const now = new Date().toISOString();
  const projectId = "project-codex-storyboard";
  let project = normalizeProject({
    id: projectId,
    title: "Codex 分镜台",
    aspectRatio: "16:9",
    shots: [],
    createdAt: now,
    updatedAt: now
  });

  const legacy = JSON.parse(await readFile(legacyDataFile, "utf8"));
  project = normalizeProject({
    ...legacy,
    id: projectId,
    title: legacy.title || "Codex 分镜台",
    aspectRatio: "16:9",
    createdAt: now
  });

  await mkdir(projectMediaDir(projectId), { recursive: true });
  if (await exists(legacyMediaDir)) {
    for (const fileName of await readdir(legacyMediaDir)) {
      await copyFile(join(legacyMediaDir, fileName), join(projectMediaDir(projectId), fileName));
    }
  }
  for (const shot of project.shots) {
    if (shot.mediaUrl) shot.mediaUrl = mediaUrl(projectId, mediaFileNameFromUrl(shot.mediaUrl));
  }

  await writeFile(projectFile(projectId), `${JSON.stringify(project, null, 2)}\n`, "utf8");
  await saveProjectsIndex({
    projects: [{
      id: project.id,
      title: project.title,
      aspectRatio: project.aspectRatio,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    }]
  });
}

async function serveFile(response, filePath, allowedRoots = [publicDir], request) {
  const normalized = resolve(filePath);
  const allowed = allowedRoots.some((base) => {
    const normalizedBase = resolve(base);
    const relativePath = relative(normalizedBase, normalized);
    return relativePath === "" ||
      (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`));
  });
  if (!allowed) return sendError(response, 403, "Forbidden");

  try {
    const file = await readFile(normalized);
    const contentType = contentTypes[extname(normalized).toLowerCase()] || "application/octet-stream";
    const rangeHeader = request?.headers?.range;
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      const total = file.byteLength;
      if (!match || (!match[1] && !match[2]) || total === 0) {
        response.writeHead(416, { "content-range": `bytes */${total}`, "content-length": "0" });
        return response.end();
      }
      let start;
      let end;
      if (match[1]) {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : total - 1;
      } else {
        const suffixLength = Number(match[2]);
        start = Math.max(total - suffixLength, 0);
        end = total - 1;
      }
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= total || end < start) {
        response.writeHead(416, { "content-range": `bytes */${total}`, "content-length": "0" });
        return response.end();
      }
      end = Math.min(end, total - 1);
      const chunk = file.subarray(start, end + 1);
      response.writeHead(206, {
        "content-type": contentType,
        "content-length": String(chunk.byteLength),
        "content-range": `bytes ${start}-${end}/${total}`,
        "accept-ranges": "bytes",
        "cache-control": "no-store"
      });
      return response.end(chunk);
    }
    response.writeHead(200, {
      "content-type": contentType,
      "content-length": String(file.byteLength),
      "accept-ranges": "bytes",
      "cache-control": "no-store"
    });
    response.end(file);
  } catch (error) {
    if (error.code === "ENOENT") return sendError(response, 404, "Not found");
    throw error;
  }
}

async function handleProjectsApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/projects") {
    const index = await readProjectsIndex();
    const projects = await Promise.all(index.projects.map(projectSummary));
    return sendJson(response, 200, { projects });
  }

  if (request.method === "POST" && url.pathname === "/api/projects") {
    const body = await readBody(request);
    const project = normalizeProject({
      id: createId("project"),
      title: body.title,
      aspectRatio: body.aspectRatio,
      shots: Array.isArray(body.shots) ? body.shots : []
    });
    return sendJson(response, 201, await saveProject(project));
  }

  const designMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/design$/);
  if (designMatch) {
    const projectId = decodeURIComponent(designMatch[1]);
    const project = await readProject(projectId);

    if (request.method === "GET") {
      if (!project.hasDesign) return sendError(response, 404, "当前项目没有 DESIGN.md");
      return sendJson(response, 200, {
        hasDesign: true,
        content: await readFile(projectDesignFile(projectId), "utf8")
      });
    }

    if (request.method === "POST") {
      await saveUploadedDesign(project, request);
      return sendJson(response, 200, await saveProject(project));
    }

    if (request.method === "DELETE") {
      await rm(projectDesignFile(projectId), { force: true });
      project.hasDesign = false;
      return sendJson(response, 200, await saveProject(project));
    }

    return false;
  }

  const mediaFolderMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/media-folder$/);
  if (mediaFolderMatch) {
    const projectId = decodeURIComponent(mediaFolderMatch[1]);
    const project = await readProject(projectId);
    const folderPath = projectMediaDir(project.id);

    if (request.method === "GET") {
      await mkdir(folderPath, { recursive: true });
      return sendJson(response, 200, { path: folderPath });
    }

    if (request.method === "POST") {
      await openLocalFolder(folderPath);
      return sendJson(response, 200, { path: folderPath, opened: true });
    }

    return false;
  }

  const exportDocxMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/export\/docx$/);
  if (exportDocxMatch) {
    const project = await readProject(decodeURIComponent(exportDocxMatch[1]));
    if (request.method === "GET") {
      const buffer = await buildProjectDocx(project);
      return sendDocx(response, `${safeDownloadFileName(`${project.title}-分镜脚本`)}.docx`, buffer);
    }
    return false;
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (!projectMatch) return false;
  const projectId = decodeURIComponent(projectMatch[1]);

  if (request.method === "GET") {
    return sendJson(response, 200, await readProject(projectId));
  }

  if (request.method === "PUT") {
    const current = await readProject(projectId);
    const body = await readBody(request);
    if (body.updatedAt && body.updatedAt !== current.updatedAt) {
      return sendError(response, 409, "项目已在其他窗口或生成任务中更新，请保留当前文本并刷新后重试");
    }
    return sendJson(response, 200, await saveProject({
      ...current,
      title: body.title,
      aspectRatio: body.aspectRatio,
      scriptDraft: body.scriptDraft ?? current.scriptDraft,
      covers: body.covers || current.covers,
      shots: body.shots
    }));
  }

  if (request.method === "PATCH") {
    const project = await readProject(projectId);
    const body = await readBody(request);
    if (body.title !== undefined) project.title = String(body.title).trim() || project.title;
    if (body.aspectRatio !== undefined) project.aspectRatio = normalizeAspectRatio(body.aspectRatio);
    return sendJson(response, 200, await saveProject(project));
  }

  if (request.method === "DELETE") {
    const project = await readProject(projectId);
    await rm(projectDir(projectId), { recursive: true, force: false });
    const index = await readProjectsIndex();
    index.projects = index.projects.filter((item) => item.id !== projectId);
    await saveProjectsIndex(index);
    return sendJson(response, 200, { deleted: project.id });
  }

  return false;
}

async function handleShotsApi(request, response, url) {
  const collectionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/shots$/);
  if (collectionMatch && request.method === "POST") {
    const project = await readProject(decodeURIComponent(collectionMatch[1]));
    const body = await readBody(request);
    const incoming = Array.isArray(body.shots) ? body.shots : [body.shot || body];
    project.shots.push(...incoming.map(normalizeShot));
    return sendJson(response, 201, await saveProject(project));
  }

  const shotMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/shots\/([^/]+)$/);
  if (shotMatch) {
    const project = await readProject(decodeURIComponent(shotMatch[1]));
    const shotId = decodeURIComponent(shotMatch[2]);
    const index = project.shots.findIndex((shot) => shot.id === shotId);
    if (index < 0) return sendError(response, 404, "Shot not found");

    if (request.method === "PATCH") {
      const body = await readBody(request);
      project.shots[index] = normalizeShot({ ...project.shots[index], ...body, id: shotId });
      return sendJson(response, 200, await saveProject(project));
    }

    if (request.method === "DELETE") {
      project.shots.splice(index, 1);
      return sendJson(response, 200, await saveProject(project));
    }
  }

  const mediaMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/shots\/([^/]+)\/media$/);
  if (mediaMatch) {
    const project = await readProject(decodeURIComponent(mediaMatch[1]));
    const shot = project.shots.find((item) => item.id === decodeURIComponent(mediaMatch[2]));
    if (!shot) return sendError(response, 404, "Shot not found");

    if (request.method === "POST") {
      if ((request.headers["content-type"] || "").startsWith("multipart/form-data")) {
        await saveUploadedMedia(project, shot, request);
      } else {
        const body = await readBody(request);
        if (!body.sourcePath) return sendError(response, 400, "sourcePath is required");
        await attachMedia(project, shot, body.sourcePath, body.mediaType);
      }
      return sendJson(response, 200, await saveProject(project));
    }

    if (request.method === "DELETE") {
      if (shot.generationStatus === "processing") {
        return sendError(response, 409, "生成中的素材暂时无法删除");
      }
      if (shot.mediaUrl) {
        const fileName = basename(mediaFileNameFromUrl(shot.mediaUrl));
        await rm(join(projectMediaDir(project.id), fileName), { force: true });
      }
      shot.mediaUrl = "";
      shot.generationStatus = "idle";
      shot.generationTaskId = "";
      shot.generationError = "";
      shot.generationRequestedAt = null;
      shot.generationStartedAt = null;
      shot.generationCompletedAt = null;
      return sendJson(response, 200, await saveProject(project));
    }
  }

  return false;
}

async function handleCoversApi(request, response, url) {
  const coverMatch = url.pathname.match(
    /^\/api\/projects\/([^/]+)\/covers\/(vertical|horizontal)(?:\/(media|reference))?$/
  );
  if (!coverMatch) return false;

  const project = await readProject(decodeURIComponent(coverMatch[1]));
  const cover = project.covers[coverMatch[2]];
  if (!cover) return sendError(response, 404, "Cover not found");

  if (request.method === "PATCH") {
    const body = await readBody(request);
    if (body.preset !== undefined) cover.preset = String(body.preset || "custom");
    if (body.title !== undefined) cover.title = String(body.title || "");
    if (body.prompt !== undefined) cover.prompt = String(body.prompt || "");
    return sendJson(response, 200, await saveProject(project));
  }

  if (request.method === "POST" && coverMatch[3] === "reference") {
    if (cover.generationStatus === "processing") {
      return sendError(response, 409, "生成中的封面暂时无法替换参考图");
    }
    await saveUploadedCoverReference(project, cover, request);
    return sendJson(response, 200, await saveProject(project));
  }

  if (request.method === "DELETE" && coverMatch[3] === "reference") {
    if (cover.generationStatus === "processing") {
      return sendError(response, 409, "生成中的封面暂时无法删除参考图");
    }
    await removeCurrentMedia(project, cover.referenceUrl);
    cover.referenceUrl = "";
    return sendJson(response, 200, await saveProject(project));
  }

  if (request.method === "POST" && coverMatch[3] === "media") {
    if (cover.generationStatus === "processing") {
      return sendError(response, 409, "生成中的封面暂时无法替换");
    }
    await saveUploadedCover(project, cover, request);
    return sendJson(response, 200, await saveProject(project));
  }

  if (request.method === "DELETE" && coverMatch[3] === "media") {
    if (cover.generationStatus === "processing") {
      return sendError(response, 409, "生成中的封面暂时无法删除");
    }
    await removeCurrentMedia(project, cover.mediaUrl);
    cover.mediaUrl = "";
    cover.generationStatus = "idle";
    cover.generationTaskId = "";
    cover.generationError = "";
    cover.generationRequestedAt = null;
    cover.generationStartedAt = null;
    cover.generationCompletedAt = null;
    return sendJson(response, 200, await saveProject(project));
  }

  return false;
}

async function handleGenerationApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/generation/tasks") {
    const index = await readProjectsIndex();
    const statuses = (url.searchParams.get("status") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const tasks = [];
    for (const record of index.projects) {
      const project = await readProject(record.id);
      tasks.push(...project.shots
        .filter((shot) => shot.generationTaskId)
        .filter((shot) => statuses.length === 0 || statuses.includes(shot.generationStatus))
        .map((shot) => generationTask(project, shot)));
      tasks.push(...Object.values(project.covers)
        .filter((cover) => cover.generationTaskId)
        .filter((cover) => statuses.length === 0 || statuses.includes(cover.generationStatus))
        .map((cover) => generationTask(project, cover, "cover")));
    }
    return sendJson(response, 200, { tasks });
  }

  if (request.method === "POST" && url.pathname === "/api/generation/tasks") {
    const body = await readBody(request);
    if (!body.projectId) return sendError(response, 400, "projectId is required");
    const project = await readProject(String(body.projectId));
    const requestedIds = Array.isArray(body.shotIds) ? new Set(body.shotIds.map(String)) : null;
    const requestedCoverTypes = Array.isArray(body.coverTypes)
      ? new Set(body.coverTypes.map(String).filter((type) => coverRatios[type]))
      : null;
    const force = body.force === true;
    const queued = [];
    const skipped = [];

    if (requestedIds || !requestedCoverTypes) {
      for (const shot of project.shots) {
        if (requestedIds && !requestedIds.has(shot.id)) continue;
        if (shot.generator === "manual") {
          skipped.push({ shotId: shot.id, reason: "manual" });
          continue;
        }
        if (!shot.visualPrompt.trim()) {
          skipped.push({ shotId: shot.id, reason: "missing-prompt" });
          continue;
        }
        if (["pending", "processing"].includes(shot.generationStatus)) {
          skipped.push({ shotId: shot.id, reason: shot.generationStatus });
          continue;
        }
        if (!force && shot.generationStatus === "ready") {
          skipped.push({ shotId: shot.id, reason: "ready" });
          continue;
        }

        shot.generationTaskId = createTaskId();
        shot.generationStatus = "pending";
        shot.generationError = "";
        shot.generationRequestedAt = new Date().toISOString();
        shot.generationStartedAt = null;
        shot.generationCompletedAt = null;
        queued.push(generationTask(project, shot));
      }
    }

    if (requestedCoverTypes) {
      for (const coverType of requestedCoverTypes) {
        const cover = project.covers[coverType];
        if (!cover.prompt.trim()) {
          skipped.push({ coverType, reason: "missing-prompt" });
          continue;
        }
        if (["pending", "processing"].includes(cover.generationStatus)) {
          skipped.push({ coverType, reason: cover.generationStatus });
          continue;
        }
        if (!force && cover.generationStatus === "ready") {
          skipped.push({ coverType, reason: "ready" });
          continue;
        }

        cover.generationTaskId = createTaskId();
        cover.generationStatus = "pending";
        cover.generationError = "";
        cover.generationRequestedAt = new Date().toISOString();
        cover.generationStartedAt = null;
        cover.generationCompletedAt = null;
        queued.push(generationTask(project, cover, "cover"));
      }
    }

    const saved = await saveProject(project);
    return sendJson(response, 201, { project: saved, queued, skipped });
  }

  const taskMatch = url.pathname.match(
    /^\/api\/generation\/tasks\/([^/]+)\/(claim|complete|fail|cancel|heartbeat)$/
  );
  if (taskMatch && request.method === "POST") {
    return mutateGenerationTask(async () => {
      const [, taskId, action] = taskMatch;
      const found = await findTask(decodeURIComponent(taskId));
      if (!found) return sendError(response, 404, "Generation task not found");
      const { project, item, taskType } = found;
      const body = await readBody(request);

      if (["complete", "fail", "heartbeat"].includes(action) && !["pending", "processing"].includes(item.generationStatus)) {
        return sendError(response, 409, `Task is ${item.generationStatus}`);
      }
      if (action === "heartbeat") item.generationHeartbeatAt = new Date().toISOString();
      if (action === "claim") {
        if (item.generationStatus !== "pending") {
          return sendError(response, 409, `Task is ${item.generationStatus}`);
        }
        item.generationStatus = "processing";
        item.generationStartedAt = new Date().toISOString();
        item.generationHeartbeatAt = item.generationStartedAt;
      }

      if (action === "complete") {
        if (!body.sourcePath) return sendError(response, 400, "sourcePath is required");
        if (taskType === "cover") await attachCoverMedia(project, item, body.sourcePath);
        else await attachMedia(project, item, body.sourcePath, body.mediaType);
      }

      if (action === "fail") {
        item.generationStatus = "failed";
        item.generationError = String(body.error || "生成失败");
        item.generationCompletedAt = new Date().toISOString();
      }

      if (action === "cancel") {
        if (!["pending", "processing"].includes(item.generationStatus)) {
          return sendError(response, 409, `Task is ${item.generationStatus}`);
        }
        item.generationStatus = item.mediaUrl ? "ready" : "idle";
        item.generationTaskId = "";
        item.generationError = "";
        item.generationRequestedAt = null;
        item.generationStartedAt = null;
        item.generationCompletedAt = item.mediaUrl ? item.generationCompletedAt : null;
      }

      const saved = await saveProject(project);
      const savedItem = taskType === "cover"
        ? saved.covers[item.type]
        : saved.shots.find((shot) => shot.id === item.id);
      return sendJson(response, 200, {
        project: saved,
        task: generationTask(saved, savedItem, taskType)
      });
    });
  }

  return false;
}

async function handleApi(request, response, url) {
  const audioReferenceMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/audio\/reference$/);
  if (audioReferenceMatch) {
    const projectId = decodeURIComponent(audioReferenceMatch[1]);
    const project = await readProject(projectId);
    if (audioJobs.has(projectId)) return sendError(response, 409, "配音任务正在处理，暂时无法修改参考音频");
    if (request.method === "POST") {
      await saveUploadedAudioReference(project, request);
      return sendJson(response, 200, await saveProject(project));
    }
    if (request.method === "DELETE") {
      await removeAudioReference(project);
      return sendJson(response, 200, await saveProject(project));
    }
  }

  const audioMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/audio\/(generate|select|align|apply-durations)$/);
  if (audioMatch && request.method === "POST") {
    const [, projectId, action] = audioMatch;
    const project = await readProject(projectId);
    const body = await readBody(request);
    if (audioJobs.has(projectId)) return sendError(response, 409, "配音任务正在处理");
    if (["align", "apply-durations"].includes(action)) {
      const take = project.audio.takes.find(t => t.id === project.audio.selectedId);
      if (!take) return sendError(response, 400, "请先生成或选择配音");
      if (action === "apply-durations") {
        try { project.shots = applyTiming(project.shots, take, body.timeline || take.timeline); }
        catch (error) { return sendError(response, 409, error.message); }
        if (body.timeline) take.timeline = body.timeline;
        take.appliedAt = new Date().toISOString();
        return sendJson(response, 200, await saveProject(project));
      }
      if (!spokenText(project.shots)) return sendError(response, 409, "当前项目没有带台词的镜头，无法进行对齐");
      if (!voiceTextsMatch(projectVoiceText(project), take.text)) return sendError(response, 409, "当前镜头台词与此配音文本不同，请重新生成配音后对齐");
      audioJobs.add(projectId);
      project.audio.status = "aligning";
      project.audio.error = "";
      const saved = await saveProject(project);
      void alignVoice(join(projectMediaDir(projectId), basename(take.fileName)), project.shots, take.durationMs).then(alignment => serializeApi(async () => {
        const current = await readProject(projectId);
        const version = current.audio.takes.find(t => t.id === take.id);
        if (!version) throw new Error("配音版本已移除");
        version.timeline = alignment.timeline;
        version.recognition = alignment.recognition;
        version.dialogueKey = dialogueKey(project.shots);
        version.alignEngine = alignment.engine;
        current.audio.status = "ready";
        await saveProject(current);
      })).catch(error => serializeApi(async () => {
        try {
          const current = await readProject(projectId);
          current.audio.status = "failed"; current.audio.error = error.message;
          await saveProject(current);
        } catch (saveError) { console.error(saveError); }
      })).finally(() => audioJobs.delete(projectId));
      return sendJson(response, 202, saved);
    }
    if (action === "select") {
      if (!project.audio.takes.some(take => take.id === body.takeId)) return sendError(response, 404, "配音版本不存在");
      project.audio.selectedId = body.takeId;
      return sendJson(response, 200, await saveProject(project));
    }
    const text = projectVoiceText(project);
    if (!text || text.length > 10000) return sendError(response, 400, "请填写台词或脚本，最多 10000 字");
    const id = createId("voice");
    const instruction = String(body.instruction || "").slice(0, 1000);
    const reference = project.audio.reference;
    const referenceFileName = basename(String(reference?.fileName || ""));
    const referencePath = referenceFileName ? join(projectMediaDir(projectId), referenceFileName) : null;
    if (referencePath && !(await exists(referencePath))) return sendError(response, 409, "参考音频文件不存在，请重新上传");
    const referenceText = String(body.referenceText ?? reference?.text ?? "").slice(0, 1000);
    if (reference) reference.text = referenceText;
    project.audio.status = "generating";
    project.audio.error = "";
    project.audio.startedAt = new Date().toISOString();
    audioJobs.add(projectId);
    const saved = await saveProject(project);
    void generateVoice({
      directory: projectMediaDir(projectId),
      id,
      text,
      instruction,
      promptWav: referencePath,
      promptText: referenceText
    }).then(result => serializeApi(async () => {
      const current = await readProject(projectId);
      current.audio.takes.push({
        id,
        ...result,
        url: mediaUrl(projectId, result.fileName),
        text,
        instruction,
        referenceFileName,
        referenceText,
        createdAt: new Date().toISOString()
      });
      current.audio.selectedId = id;
      current.audio.status = "ready";
      await saveProject(current);
    })).catch(error => serializeApi(async () => {
      try {
        const current = await readProject(projectId);
        current.audio.status = "failed";
        current.audio.error = String(error.message).slice(-1500);
        await saveProject(current);
      } catch (saveError) { console.error(saveError); }
    })).finally(() => audioJobs.delete(projectId));
    return sendJson(response, 202, saved);
  }
  if (request.method === "GET" && url.pathname === "/api/environment") {
    return sendJson(response, 200, await inspectEnvironment());
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, {
      ok: true,
      app: "codex-storyboard",
      version: "0.6.8",
      dataDir,
      publicDir
    });
  }

  if (await handleProjectsApi(request, response, url)) return;
  if (await handleShotsApi(request, response, url)) return;
  if (await handleCoversApi(request, response, url)) return;
  if (await handleGenerationApi(request, response, url)) return;
  return sendError(response, 404, "API not found");
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return sendError(response, 403, "Local host required");
    if (request.headers.origin && request.headers.origin !== url.origin) return sendError(response, 403, "Cross-origin requests are not allowed");
    if (url.pathname.startsWith("/api/")) return await serializeApi(() => handleApi(request, response, url));

    const mediaMatch = url.pathname.match(/^\/media\/([^/]+)\/([^/]+)$/);
    if (mediaMatch) {
      const projectId = decodeURIComponent(mediaMatch[1]);
      const fileName = basename(decodeURIComponent(mediaMatch[2]));
      if (!safeId(projectId)) return sendError(response, 404, "Not found");
      return await serveFile(
        response,
        join(projectMediaDir(projectId), fileName),
        [projectMediaDir(projectId)],
        request
      );
    }

    if (url.pathname === "/" || url.pathname.match(/^\/project\/[^/]+\/?$/)) {
      return await serveFile(response, join(publicDir, "index.html"));
    }
    return await serveFile(response, join(publicDir, decodeURIComponent(url.pathname.slice(1))));
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    return sendError(response, status, error.message || "Internal server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Codex 分镜台已启动：http://127.0.0.1:${port}`);
  console.log(`数据目录：${dataDir}`);
});
