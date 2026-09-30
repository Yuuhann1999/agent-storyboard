import { createAutosave } from "./autosave.js";
import { inspectPacingDetailed } from "./pacing.js";
import { newShotId, moveShot, cloneShot, shotMatches, shotStatusCounts } from "./shots.js";
import { renderVoicePlayer } from "./voice-player.js";
const projectsView = document.querySelector("#projects-view");
const storyboardView = document.querySelector("#storyboard-view");
const scriptPanel = document.querySelector("#script-panel");
const storyboardPanel = document.querySelector("#storyboard-panel");
const assetsPanel = document.querySelector("#assets-panel");
const projectsGrid = document.querySelector("#projects-grid");
const projectCardTemplate = document.querySelector("#project-card-template");
const body = document.querySelector("#shots-body");
const shotTemplate = document.querySelector("#shot-row-template");
const saveStatus = document.querySelector("#save-status");
const durationTotal = document.querySelector("#duration-total");
const selectPortal = document.querySelector("#select-portal");
const generateAllButton = document.querySelector("#generate-all");
const projectDialog = document.querySelector("#project-dialog");
const projectForm = document.querySelector("#project-form");
const projectNameInput = document.querySelector("#project-name-input");
const ratioOptions = document.querySelector("#ratio-options");
const deleteDialog = document.querySelector("#delete-dialog");
const mediaUpload = document.querySelector("#media-upload");
const projectDesignOption = document.querySelector("#project-design-option");
const projectDesignUpload = document.querySelector("#project-design-upload");
const designUpload = document.querySelector("#design-upload");
const designDialog = document.querySelector("#design-dialog");
const removeDesignDialog = document.querySelector("#remove-design-dialog");
const designMenu = document.querySelector("#design-menu");
const designMenuTrigger = document.querySelector("#design-menu-trigger");
const designMenuPopover = document.querySelector("#design-menu-popover");
const lightbox = document.querySelector("#lightbox");
const lightboxStage = document.querySelector("#lightbox-stage");
const coverPanel = document.querySelector("#cover-panel");
const coverPreviewFrame = document.querySelector("#cover-preview-frame");
const coverPreview = document.querySelector("#cover-preview");
const coverStatus = document.querySelector("#cover-status");
const coverPreset = document.querySelector("#cover-preset");
const coverTitle = document.querySelector("#cover-title");
const coverPromptField = document.querySelector("#cover-prompt-field");
const coverPrompt = document.querySelector("#cover-prompt");
const coverUpload = document.querySelector("#cover-upload");
const coverReferenceUpload = document.querySelector("#cover-reference-upload");
const coverReferencePreview = document.querySelector("#cover-reference-preview");
const voiceReferenceUpload = document.querySelector("#voice-reference-upload");
const toast = document.querySelector("#toast");
const themeButtons = document.querySelectorAll("[data-theme-toggle]");
const themeStorageKey = "codex-storyboard-theme";
const scriptDraft = document.querySelector("#script-draft");
const scriptCount = document.querySelector("#script-count");
const assetsGrid = document.querySelector("#assets-grid");
const presenter = document.querySelector("#presenter");
const presenterStage = document.querySelector("#presenter-stage");
const presenterStrip = document.querySelector("#presenter-strip");
const arollPlaceholderUrl = "/assets/aroll-placeholder.png";
const stylesView = document.querySelector("#styles-view");
const stylesGrid = document.querySelector("#styles-grid");
const stylesFilters = document.querySelector("#styles-filters");
const styleDetailDialog = document.querySelector("#style-detail-dialog");
const styleApplyDialog = document.querySelector("#style-apply-dialog");

const ratios = ["9:16", "16:9", "3:4", "4:3", "1:1"];
const selectOptions = {
  rollType: [
    { value: "A-ROLL", label: "A-ROLL" },
    { value: "B-ROLL", label: "B-ROLL" }
  ],
  mediaType: [
    { value: "image", label: "图片" },
    { value: "video", label: "视频" }
  ],
  generator: [
    { value: "manual", label: "手动素材", hint: "自己上传图片或视频" },
    { value: "image-gen", label: "AI 生图", hint: "Image Generation：按画面描述生成图片" },
    { value: "hyperframes", label: "HyperFrames 动效", hint: "用 HTML 生成动画 / 字幕 / 信息图视频" },
    { value: "remotion", label: "Remotion 动效", hint: "用 React 生成程序化动画视频" }
  ]
};

const coverPresets = [
  {
    value: "clean-explainer",
    label: "干净知识封面",
    skill: "clean-video-cover",
    buildPrompt: ({ topic, titleRule, ratio }) => `Use case: ads-marketing
Asset type: clean ${ratio} Chinese short-video cover
Source skill: clean-video-cover / video-cover-maker

Primary request:
Create a simple, clean Chinese short-video cover for this topic:
${topic}

Style formula:
大标题关键词 + 产品 logo / 主体符号 + 一个清晰隐喻。
只保留一个核心隐喻，不要拼贴，不要复杂 UI，不要过多图标。

Visual style:
- Background: off-white / light grey with subtle paper grain.
- Typography: oversized ultra-bold condensed Chinese block lettering, slightly slanted or irregular, rough paper-grain texture inside letters, subtle blue offset shadow, strong dark charcoal fill.
- Accent color: only one cyan / blue / green accent.
- Layout: logo or subject symbol near top, big keyword in the middle, short subtitle below, one simple metaphor at bottom.
- Keep enough negative space. Feed-size readability first.

Text rules:
- ${titleRule}
- Chinese text must be perfectly legible and correctly spelled.
- No extra slogans, fake logos, watermarks, UI chrome, or unrelated captions.
- Final image aspect ratio: ${ratio}.`
  },
  {
    value: "black-overlay",
    label: "黑蒙版白字",
    skill: "short-video-cover",
    buildPrompt: ({ topic, titleRule, ratio }) => `Use case: short-video talking-head cover
Asset type: ${ratio} Chinese short-video cover
Source skill: short-video-cover / video-cover-maker

Primary request:
Create a direct口播 style cover for this topic:
${topic}

Visual style:
- Use a photographic background or a provided reference photo if available.
- Add a full-canvas semi-transparent black overlay around 45% opacity.
- Add a huge white Chinese title in bold Songti / serif style, centered in the middle visual area.
- Title should occupy roughly 45%-65% of the cover width.
- If a face is present, do not cover the eyes.

Rules:
- ${titleRule}
- Chinese text must be perfectly legible and correctly spelled.
- No extra subtitles, logos, stickers, borders, UI elements, beautification, or unrelated decoration.
- Final image aspect ratio: ${ratio}.`
  },
  {
    value: "viral-head",
    label: "真人抠头爆款",
    skill: "viral-head-cover",
    buildPrompt: ({ topic, titleRule, ratio }) => `Use case: viral Chinese short-video thumbnail
Asset type: ${ratio} cover
Source skill: viral-head-cover / video-cover-maker

Primary request:
Create a high-impact viral Chinese short-video cover for this topic:
${topic}
If a portrait reference is provided, cut out only the person's head and hair, preserve identity, then place the head onto a stylized thumbnail character body in a clean exaggerated scene.

Scene direction:
Use a simple metaphor scene related to the title. Keep the background clean and high contrast. Do not create a messy poster collage.

Typography:
- Big Chinese headline with yellow or white fill, black stroke, strong thumbnail readability.
- Split into 2-4 compact lines if needed.
- ${titleRule}

Rules:
- Preserve identity when a real portrait is provided.
- Chinese text must be perfectly legible and correctly spelled.
- No extra text, fake UI, stickers, watermarks, or unrelated props.
- Final image aspect ratio: ${ratio}.`
  },
  {
    value: "custom",
    label: "自定义 / 导入",
    skill: "custom",
    buildPrompt: () => ""
  }
];

let project = null;
let projects = [];
let pollTimer;
let activeSelect;
let dialogMode = "create";
let editingProjectId = "";
let deletingProjectId = "";
let uploadShotId = "";
let lightboxShotId = "";
let toastTimer;
let pendingProjectDesign = null;
let designMenuPinned = false;
let designMenuCloseTimer;
let activeCoverType = "vertical";
let activeProjectTab = "storyboard";
let activeAssetFilter = "all";
let presenterItems = [];
let presenterIndex = 0;
let activeHomeTab = "projects";
let activeStyleFilter = "all";
let styleData = [];
let pendingStyleId = "";
let targetProjectId = "";
let projectQuery = "";
let shotQuery = "";
let density = readPreference("codex-storyboard-density", "comfortable");
let dragShotId = "";

function readPreference(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function writePreference(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 本地存储不可用时仅本次生效 */ }
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["content-type"] = "application/json";
  const response = await fetch(path, { ...options, headers });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.error || "请求失败");
    error.status = response.status;
    throw error;
  }
  return value;
}

function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function updateThemeButtons() {
  const isDark = currentTheme() === "dark";
  themeButtons.forEach((button) => {
    button.setAttribute("aria-label", isDark ? "切换到浅色主题" : "切换到深色主题");
    button.title = isDark ? "切换到浅色主题" : "切换到深色主题";
  });
}

function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(themeStorageKey, next);
  } catch {
    // 浏览器禁用本地存储时，本次切换仍然生效。
  }
  updateThemeButtons();
}

function showToast(message, type = "info", action = null) {
  clearTimeout(toastTimer);
  toast.replaceChildren(document.createTextNode(message));
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener("click", () => { toast.hidden = true; action.run(); });
    toast.append(button);
  }
  toast.dataset.type = type;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, action ? 7000 : 2600);
}

function emptyShot() {
  return {
    rollType: "B-ROLL",
    mediaType: "image",
    duration: 5,
    dialogue: "",
    visualPrompt: "",
    generator: "image-gen",
    mediaUrl: "",
    notes: "",
    generationStatus: "idle",
    generationTaskId: "",
    generationError: ""
  };
}

function emptyCover(type) {
  return {
    type,
    preset: "custom",
    title: "",
    prompt: "",
    referenceUrl: "",
    mediaUrl: "",
    generationStatus: "idle",
    generationTaskId: "",
    generationError: ""
  };
}

function coverRatioLabel() {
  return activeCoverType === "horizontal" ? "16:9 horizontal" : "9:16 vertical";
}

function coverPromptContext() {
  const title = coverTitle.value.trim();
  const topic = title || project?.title || "当前短视频主题";
  return {
    topic,
    ratio: coverRatioLabel(),
    titleRule: title
      ? `Main headline exactly: ${title}`
      : "No fixed headline is provided. Use a short readable Chinese title only if it improves the cover; do not render placeholder text."
  };
}

function coverPresetByValue(value) {
  return coverPresets.find((preset) => preset.value === value) || coverPresets[0];
}

function renderCoverPresetOptions() {
  coverPreset.replaceChildren(
    ...coverPresets.map((preset) => {
      const option = document.createElement("option");
      option.value = preset.value;
      option.textContent = preset.label;
      return option;
    })
  );
}

function applyCoverPreset(value) {
  if (!project) return;
  ensureCovers();
  const cover = project.covers[activeCoverType];
  const preset = coverPresetByValue(value);
  cover.preset = preset.value;
  if (preset.value !== "custom") {
    cover.prompt = preset.buildPrompt({
      ...coverPromptContext()
    });
  }
  renderCoverPanel();
  queueSave();
}

function ensureCovers() {
  if (!project) return;
  project.covers ||= {};
  project.covers.vertical ||= emptyCover("vertical");
  project.covers.horizontal ||= emptyCover("horizontal");
}

function formatDuration(seconds) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function generationLabel(shot) {
  if (shot.generator === "manual") return shot.mediaUrl ? "本地素材" : "等待上传";
  return {
    idle: "未生成",
    pending: "等待处理",
    processing: "生成中",
    ready: "已完成",
    failed: shot.generationError || "生成失败"
  }[shot.generationStatus] || "未生成";
}

function coverGenerationLabel(cover) {
  return {
    idle: cover.mediaUrl ? "已完成" : "未生成",
    pending: "等待处理",
    processing: "生成中",
    ready: "已完成",
    failed: cover.generationError || "生成失败"
  }[cover.generationStatus] || "未生成";
}

function coverGenerateLabel(cover) {
  if (cover.generationStatus === "pending") return "取消队列";
  if (cover.generationStatus === "processing") return "释放任务";
  if (!canGenerateCover(cover)) return "填写封面提示词";
  return cover.generationStatus === "ready" || cover.generationStatus === "failed"
    ? "重新生成封面"
    : "加入 Image Generation 队列";
}

function coverUsesCustomPrompt(cover) {
  return (cover.preset || "custom") === "custom";
}

function canGenerateCover(cover) {
  return !coverUsesCustomPrompt(cover) || Boolean(cover.prompt.trim());
}

function generationButtonLabel(shot) {
  if (shot.generator === "manual") return shot.mediaUrl ? "重新上传" : "本地上传";
  if (shot.generationStatus === "pending") return "取消队列";
  if (shot.generationStatus === "processing") return "释放任务";
  if (!shot.visualPrompt.trim() && !["pending", "processing"].includes(shot.generationStatus)) {
    return "填写画面描述";
  }
  if (shot.generationStatus === "ready" || shot.generationStatus === "failed") return "重新生成";
  return "生成素材";
}

function isBatchGeneratable(shot) {
  return (
    shot.generator !== "manual" &&
    Boolean(shot.visualPrompt.trim()) &&
    shot.generationStatus !== "ready"
  );
}

function updateBatchButton() {
  const count = project?.shots.filter(isBatchGeneratable).length || 0;
  generateAllButton.disabled = count === 0;
  const badge = generateAllButton.querySelector(".tool-count");
  badge.hidden = count === 0;
  badge.textContent = String(count);
  generateAllButton.setAttribute("aria-label", count > 0 ? `批量生成，${count} 个镜头待生成` : "批量生成");
  updateTaskChip();
}

function updateTaskChip() {
  const chip = document.querySelector("#task-chip");
  if (!project) { chip.hidden = true; return; }
  const counts = shotStatusCounts(project.shots, Object.values(project.covers || {}));
  const parts = [];
  if (counts.processing) parts.push(`生成中 ${counts.processing}`);
  if (counts.pending) parts.push(`排队 ${counts.pending}`);
  if (counts.failed) parts.push(`失败 ${counts.failed}`);
  chip.hidden = parts.length === 0;
  chip.textContent = parts.join(" · ");
  chip.dataset.state = counts.failed ? "failed" : "active";
  chip.title = counts.failed ? "点击定位到第一个失败的镜头" : "点击定位到正在处理的镜头";
}

function focusShotRow(index) {
  const row = body.children[index];
  if (!row) return;
  if (row.hidden) { shotQuery = ""; document.querySelector("#shot-search").value = ""; applyShotFilter(); }
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.remove("row-flash");
  void row.offsetWidth;
  row.classList.add("row-flash");
}

function safeFileName(value) {
  return String(value || "agent-storyboard")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "agent-storyboard";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function textBlock(value, fallback = "无") {
  return String(value || "").trim() || fallback;
}

function downloadText(fileName, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  downloadUrl(fileName, url);
  URL.revokeObjectURL(url);
}

function downloadUrl(fileName, url) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
}

async function downloadBlob(fileName, path) {
  const response = await fetch(path);
  if (!response.ok) {
    let message = "导出失败";
    try {
      message = (await response.json()).error || message;
    } catch {
      // 非 JSON 错误响应时保留默认提示。
    }
    throw new Error(message);
  }
  const url = URL.createObjectURL(await response.blob());
  downloadUrl(fileName, url);
  URL.revokeObjectURL(url);
}

function exportMetadataLines() {
  const duration = project.shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
  return [
    `项目：${project.title}`,
    `画面比例：${project.aspectRatio}`,
    `镜头数量：${project.shots.length}`,
    `总时长：${formatDuration(duration)}`,
    `视觉规范：${project.hasDesign ? "已配置 DESIGN.md" : "未配置"}`,
    `导出时间：${new Date().toLocaleString("zh-CN")}`
  ];
}

function buildMarkdownExport() {
  const lines = [
    `# ${project.title}`,
    "",
    ...exportMetadataLines().map((line) => `- ${line}`),
    "",
    "## 分镜脚本",
    ""
  ];

  project.shots.forEach((shot, index) => {
    lines.push(
      `### ${String(index + 1).padStart(2, "0")} · ${shot.rollType || "B-ROLL"}`,
      "",
      `- 媒体：${selectLabel("mediaType", shot.mediaType)}`,
      `- 时长：${Number(shot.duration || 0)} 秒`,
      `- 生成方式：${selectLabel("generator", shot.generator)}`,
      `- 状态：${generationLabel(shot)}`,
      "",
      "**台词文案**",
      "",
      textBlock(shot.dialogue),
      "",
      "**画面描述 / 生成提示词**",
      "",
      textBlock(shot.visualPrompt),
      "",
      "**备注**",
      "",
      textBlock(shot.notes),
      ""
    );
  });

  return `${lines.join("\n").trim()}\n`;
}

function buildPlainExport() {
  return buildMarkdownExport()
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*/g, "");
}

function renderExportParagraph(value) {
  return escapeHtml(textBlock(value)).replace(/\n/g, "<br>");
}

function buildHtmlExport() {
  const duration = project.shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
  const rows = project.shots.map((shot, index) => `
      <tr>
        <td class="num">${index + 1}</td>
        <td class="type">${escapeHtml(shot.rollType || "B-ROLL")}</td>
        <td class="duration">${Number(shot.duration || 0)}s</td>
        <td>${renderExportParagraph(shot.dialogue)}</td>
        <td>${renderExportParagraph(shot.visualPrompt)}</td>
        <td>${renderExportParagraph(shot.notes)}</td>
      </tr>
    `).join("");

  const meta = [
    `形式：${project.aspectRatio}，约 ${formatDuration(duration)}，共 ${project.shots.length} 个镜头，素材预览不在本文档展示。`,
    `视觉规范：${project.hasDesign ? "已配置 DESIGN.md" : "未配置"}。`,
    `导出时间：${new Date().toLocaleString("zh-CN")}。`
  ].join(" ");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="Agent Storyboard · Kami">
  <title>${escapeHtml(project.title)} · 分镜脚本</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 14mm;
    }
    :root {
      --paper: #f5f4ed;
      --ivory: #faf9f5;
      --brand: #1B365D;
      --ink: #141413;
      --dark-warm: #3d3d3a;
      --muted: #504e49;
      --stone: #6b6a64;
      --border: #e8e6dc;
      --border-soft: #e5e3d8;
      --table-head: #EEF2F7;
      --serif: "TsangerJinKai02", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", Georgia, serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font-family: var(--serif);
      letter-spacing: .02em;
      line-height: 1.42;
    }
    .sheet {
      width: min(1180px, calc(100vw - 28px));
      margin: 28px auto;
      padding: 28px 30px 34px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--ivory);
      box-shadow: 0 14px 48px rgba(20, 20, 19, .06);
    }
    .eyebrow {
      margin: 0 0 8px;
      color: var(--brand);
      font-size: 12px;
      font-weight: 500;
      letter-spacing: .12em;
    }
    h1 {
      margin: 0;
      color: var(--ink);
      font-size: clamp(28px, 4vw, 42px);
      font-weight: 500;
      line-height: 1.16;
      letter-spacing: -.01em;
    }
    .meta-line {
      max-width: 980px;
      margin: 14px 0 22px;
      color: var(--muted);
      font-size: 16px;
    }
    .section-title {
      margin: 22px 0 12px;
      color: var(--ink);
      font-size: 21px;
      font-weight: 500;
      line-height: 1.25;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      background: #fffefa;
      border: 1px solid var(--border);
      font-size: 15px;
    }
    th,
    td {
      border: 1px solid var(--border-soft);
      padding: 12px 13px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: var(--table-head);
      color: var(--dark-warm);
      font-weight: 500;
      white-space: nowrap;
    }
    td {
      min-height: 72px;
      color: var(--ink);
      word-break: break-word;
    }
    .num {
      width: 52px;
      color: var(--brand);
      letter-spacing: 0;
      text-align: center;
    }
    .type {
      width: 88px;
      color: var(--brand);
    }
    .duration {
      width: 66px;
      white-space: nowrap;
    }
    .dialogue { width: 28%; }
    .visual { width: 30%; }
    .notes { width: 18%; }
    .empty {
      margin: 18px 0 0;
      color: var(--stone);
      font-size: 15px;
    }
    .footer {
      margin-top: 18px;
      color: var(--stone);
      font-size: 12px;
      text-align: right;
      letter-spacing: .04em;
    }
    tr {
      break-inside: avoid;
    }
    @media print {
      body { background: white; }
      .sheet {
        width: auto;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }
      table { font-size: 10pt; }
      th, td { padding: 6pt 7pt; }
    }
    @media (max-width: 720px) {
      .sheet { padding: 24px 18px; }
      .table-wrap { overflow-x: auto; }
      table { min-width: 920px; }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <p class="eyebrow">AGENT STORYBOARD</p>
    <h1>${escapeHtml(project.title)}</h1>
    <p class="meta-line">${escapeHtml(meta)}</p>
    <h2 class="section-title">镜头脚本</h2>
    ${rows ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="num">镜头</th>
              <th class="type">类型</th>
              <th class="duration">时长</th>
              <th class="dialogue">口播/字幕</th>
              <th class="visual">录屏/画面</th>
              <th class="notes">备注</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    ` : "<p class=\"empty\">当前项目暂无镜头。</p>"}
    <p class="footer">Exported from Agent Storyboard · Kami table</p>
  </main>
</body>
</html>
`;
}

async function exportProject(format) {
  if (!project) return;
  try {
    await flushSave();
    const baseName = safeFileName(`${project.title}-分镜脚本`);
    closeDesignMenu(true);

    if (format === "markdown") {
      downloadText(`${baseName}.md`, buildMarkdownExport(), "text/markdown;charset=utf-8");
      showToast("Markdown 已导出");
      return;
    }

    if (format === "html") {
      downloadText(`${baseName}.html`, buildHtmlExport(), "text/html;charset=utf-8");
      showToast("HTML 已导出");
      return;
    }

    if (format === "word") {
      await downloadBlob(
        `${baseName}.docx`,
        `/api/projects/${encodeURIComponent(project.id)}/export/docx`
      );
      showToast("Word 已导出");
      return;
    }

    if (format === "copy") {
      await navigator.clipboard.writeText(buildPlainExport());
      showToast("脚本文本已复制");
    }
  } catch (error) {
    showToast(error.message || "导出失败", "error");
  }
}

function projectPath(projectId) {
  return `/project/${encodeURIComponent(projectId)}`;
}

function currentProjectId() {
  return decodeURIComponent(location.pathname.match(/^\/project\/([^/]+)\/?$/)?.[1] || "");
}

async function navigate(path) {
  try { await flushSave(); } catch (error) { showToast(error.message, "error"); return; }
  history.pushState({}, "", path);
  route();
}

function openProjectDialog(mode, target = null) {
  dialogMode = mode;
  editingProjectId = target?.id || "";
  document.querySelector("#project-dialog-title").textContent =
    mode === "create" ? "新建项目" : "重命名项目";
  document.querySelector("#project-submit").textContent =
    mode === "create" ? "创建项目" : "保存名称";
  projectNameInput.value = target?.title || "";
  ratioOptions.hidden = mode === "rename";
  projectDesignOption.hidden = mode === "rename";
  if (mode === "create") {
    ratioOptions.querySelector('input[value="9:16"]').checked = true;
    pendingProjectDesign = null;
    projectDesignUpload.value = "";
    document.querySelector("#project-design-file-name").textContent = "未选择 DESIGN.md";
  }
  projectDialog.showModal();
  requestAnimationFrame(() => projectNameInput.focus());
}

function renderRatioOptions() {
  ratios.forEach((ratio) => {
    const label = document.createElement("label");
    label.className = "ratio-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "aspectRatio";
    input.value = ratio;
    const shapeStage = document.createElement("span");
    shapeStage.className = "ratio-shape-stage";
    const shape = document.createElement("span");
    shape.className = "ratio-shape";
    shape.style.aspectRatio = ratio.replace(":", " / ");
    const [ratioWidth, ratioHeight] = ratio.split(":").map(Number);
    if (ratioWidth <= ratioHeight) shape.style.height = "34px";
    else shape.style.width = "38px";
    shapeStage.append(shape);
    const text = document.createElement("strong");
    text.textContent = ratio;
    label.append(input, shapeStage, text);
    ratioOptions.append(label);
  });
}

async function loadProjects() {
  const result = await api("/api/projects");
  projects = result.projects;
  renderProjects();
}

function duplicateProject(item) {
  return async () => {
    try {
      const source = await api(`/api/projects/${encodeURIComponent(item.id)}`);
      const created = await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          title: `${source.title} 副本`.slice(0, 60),
          aspectRatio: source.aspectRatio,
          shots: source.shots.map((shot) => cloneShot(shot))
        })
      });
      if (source.scriptDraft) {
        await api(`/api/projects/${encodeURIComponent(created.id)}`, {
          method: "PUT",
          body: JSON.stringify({ ...created, scriptDraft: source.scriptDraft })
        });
      }
      await loadProjects();
      showToast("已复制项目（不含素材和配音）");
    } catch (error) {
      showToast(error.message, "error");
    }
  };
}

function renderProjects() {
  projectsGrid.replaceChildren();
  const search = document.querySelector("#project-search");
  search.hidden = projects.length < 6;
  const visible = projectQuery
    ? projects.filter((item) => item.title.toLowerCase().includes(projectQuery.toLowerCase()))
    : projects;
  document.querySelector("#project-count").textContent = projectQuery
    ? `${visible.length} / ${projects.length} 个项目`
    : `${projects.length} 个项目`;

  visible.forEach((item) => {
    const card = projectCardTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.id = item.id;
    card.style.setProperty("--project-ratio", item.aspectRatio.replace(":", " / "));
    card.querySelector(".project-card-title").textContent = item.title;
    card.querySelector(".project-meta").textContent =
      `${item.shotCount} 个镜头 · ${formatDuration(item.duration)} · ${item.aspectRatio}`;
    card.querySelector(".project-placeholder strong").textContent = item.aspectRatio;
    const image = card.querySelector(".project-cover img");
    if (item.coverUrl) {
      // 封面文件丢失时回退到占位，不要露出破图和 alt 文字。
      image.addEventListener("error", () => card.classList.remove("has-cover"), { once: true });
      image.src = item.coverUrl;
      image.alt = "";
      card.classList.add("has-cover");
    }
    card.querySelector(".project-open").addEventListener("click", () => navigate(projectPath(item.id)));
    card.querySelector(".rename-project").addEventListener("click", () => openProjectDialog("rename", item));
    card.querySelector(".duplicate-project").addEventListener("click", duplicateProject(item));
    card.querySelector(".delete-project").addEventListener("click", () => {
      deletingProjectId = item.id;
      document.querySelector("#delete-message").textContent =
        `“${item.title}”包含 ${item.shotCount} 个镜头。删除后项目和全部素材将无法恢复。`;
      deleteDialog.showModal();
    });
    projectsGrid.append(card);
  });

  if (projectQuery && visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "projects-empty";
    empty.textContent = `没有找到包含“${projectQuery}”的项目`;
    projectsGrid.append(empty);
  }
  if (projects.length === 0) {
    const hint = document.createElement("div");
    hint.className = "projects-empty projects-welcome";
    hint.innerHTML = "<strong>还没有项目，从这里开始</strong><ol><li>点右边的「新建项目」，选好名称和画面比例；</li><li>把脚本贴进「脚本」页，或在你的 Agent（Codex / Claude Code）里说：<code>创建一个 9:16 的短视频分镜项目</code>；</li><li>在「分镜」页检查镜头，点「批量生成」让 Agent 出图出片，结果会自动回填。</li></ol>";
    projectsGrid.append(hint);
  }
  const add = document.createElement("button");
  add.className = "new-project-card";
  add.type = "button";
  add.innerHTML = "<span>＋</span><strong>新建项目</strong><small>选择名称与画面比例</small>";
  add.addEventListener("click", () => openProjectDialog("create"));
  projectsGrid.append(add);
}

async function loadProject(projectId) {
  try {
    project = await api(`/api/projects/${encodeURIComponent(projectId)}`);
    renderStoryboard();
    startPolling();
  } catch (error) {
    showToast("项目不存在或已被删除", "error");
    history.replaceState({}, "", "/");
    await showProjectsView();
  }
}

function showProjectsView() {
  clearInterval(pollTimer);
  closeDesignMenu(true);
  closePresenter();
  closeLightbox();
  project = null;
  showHomeTab("projects");
  return loadProjects();
}

function syncStoryboardViewport() {
  const root = document.documentElement;
  if (storyboardView.hidden || !window.matchMedia("(max-width: 1400px)").matches) {
    root.style.removeProperty("--storyboard-topbar-height");
    return;
  }
  const topbar = document.querySelector(".topbar");
  const height = Math.ceil(topbar?.getBoundingClientRect().height || 160);
  root.style.setProperty("--storyboard-topbar-height", `${height}px`);
}

function showStoryboardView(projectId) {
  projectsView.hidden = true;
  stylesView.hidden = true;
  document.querySelector(".home-sidebar").hidden = true;
  storyboardView.hidden = false;
  document.querySelector("#home-actions").hidden = true;
  document.querySelector("#storyboard-actions").hidden = false;
  syncStoryboardViewport();
  requestAnimationFrame(syncStoryboardViewport);
  return loadProject(projectId);
}

function showHomeTab(tab) {
  activeHomeTab = tab;
  document.querySelectorAll("[data-home-tab]").forEach((button) => {
    button.setAttribute("aria-current", button.dataset.homeTab === tab ? "page" : "false");
  });
  projectsView.hidden = tab !== "projects";
  stylesView.hidden = tab !== "styles";
  document.querySelector(".home-sidebar").hidden = false;
  storyboardView.hidden = true;
  document.querySelector("#home-actions").hidden = false;
  document.querySelector("#storyboard-actions").hidden = true;
  syncStoryboardViewport();
  document.title = "Agent 分镜台";
  if (tab === "styles") loadStylesView();
}

function route() {
  const projectId = currentProjectId();
  return projectId ? showStoryboardView(projectId) : showProjectsView();
}

function renderProjectTabs() {
  document.querySelectorAll("[data-project-tab]").forEach((button) => {
    const selected = button.dataset.projectTab === activeProjectTab;
    button.setAttribute("aria-current", selected ? "page" : "false");
  });
  scriptPanel.hidden = activeProjectTab !== "script";
  storyboardPanel.hidden = activeProjectTab !== "storyboard";
  assetsPanel.hidden = activeProjectTab !== "assets";
  document.querySelector("#add-shot-top").hidden = activeProjectTab !== "storyboard";
  generateAllButton.hidden = activeProjectTab !== "storyboard";
}

function renderScriptPanel() {
  const value = project.scriptDraft || "";
  if (scriptDraft.value !== value) scriptDraft.value = value;
  scriptCount.textContent = `${value.trim().length} 字`;
}

function buildVoiceTimelinePrompt() {
  const audio = project?.audio || {};
  const takes = Array.isArray(audio.takes) ? audio.takes : [];
  const take = takes.find(item => item.id === audio.selectedId);
  const timeline = Array.isArray(take?.timeline)
    ? take.timeline.filter(segment => (
      String(segment.text || "").trim() &&
      Number.isFinite(Number(segment.start)) &&
      Number.isFinite(Number(segment.end))
    ))
    : [];
  const isAligned = Boolean(
    take?.alignEngine?.startsWith("whisper") &&
    timeline.length
  );

  if (!isAligned) {
    return [
      "配音时间轴：",
      "当前没有已生成且完成识别对齐的配音时间轴，请忽略配音时间轴，不要自行估算时间。"
    ];
  }

  return [
    "配音时间轴（当前选中的已生成并完成识别对齐版本，单位：毫秒）：",
    ...timeline.map(segment => `[${segment.start}ms - ${segment.end}ms] ${String(segment.text).trim()}`)
  ];
}

function buildStoryboardPrompt() {
  const draft = (project.scriptDraft || "").trim();
  const ratio = project.aspectRatio || "16:9";
  const projectId = project.id || "（当前项目 ID 未知，请先通过 list_storyboard_projects 查找）";
  return [
    "这是一个写回 Agent 分镜台的执行指令，不是让你在聊天里输出 Markdown 表格。",
    `目标项目：${project.title}`,
    `项目 ID：${projectId}`,
    "",
    `请基于下面的口播文案和（如果存在）第一步生成的配音时间轴，站在导演视角，为 Agent 分镜台项目「${project.title}」生成完整的视觉编排，并直接写入上述项目的“分镜”页表格。`,
    "",
    "现在只完成视觉编排阶段：只生成并写入镜头规划，不要直接制作图片、动画或视频，也不要调用任何素材生成工具。",
    "",
    "## 必须执行的写回流程",
    "1. 使用 get_storyboard_project 读取上述项目，确认项目 ID、画面比例、脚本和现有镜头。项目 ID 已提供时不要凭标题猜测另一个项目。",
    "2. 先在内部完成导演视角的语义拆镜和全片检查，不要把中间表格输出到聊天中。",
    "3. 将每个镜头转换为项目支持的结构化字段：rollType、mediaType、duration、dialogue、visualPrompt、generator、notes。",
    "4. 使用一次 update_storyboard_project 把结果写回当前项目的“分镜”页：已有镜头按顺序用 shotUpdates 覆盖，镜头不足用 appendShots 追加；确实多出的旧镜头才放入 deleteShotIds。不要删除项目、脚本、设计文件或已有媒体文件。",
    "5. 写回后读取项目确认镜头数量和关键字段已经保存。不要调用 image-gen、hyperframes、remotion 或其他素材生成工具；这里的 generator 只是后续制作计划。",
    "6. 最终聊天回复不要输出完整视觉编排表；请报告写入了多少个镜头、全片检查结论、需要补充的素材、需要确认的视觉方向、制作难度较高的镜头和项目链接。",
    "",
    "## 我提供的内容",
    "口播文案：",
    draft || "（这里还没有填写脚本草稿）",
    "",
    ...buildVoiceTimelinePrompt(),
    "",
    "## 基础项目约束",
    `- 画面比例：${ratio}`,
    "- 后续落地到 Agent 分镜台时，每个镜头需要能够明确映射到 rollType、mediaType、duration、dialogue、visualPrompt、generator、notes。",
    "- A-ROLL 用于真人口播或主讲；B-ROLL 用于画面补充、录屏、数据图、动画。",
    "- generator 只能使用 manual、image-gen、hyperframes、remotion。",
    "- visualPrompt 要能直接指导图片或视频素材生成。",
    "- A-ROLL 通常使用 mediaType=video、generator=manual；B-ROLL 的设计动效优先使用 mediaType=video、generator=hyperframes。generator 只记录计划，不在本次执行中排队生成。",
    "",
    "## 编排原则",
    "先理解整篇文案的逻辑，再把它拆成完整的语义段落。不要按标点、句子长度或每次停顿机械切镜。",
    "",
    "每个镜头都要先回答：",
    "1. 这一段最需要观众理解什么？",
    "2. 什么画面能让这句话变得更具体、更容易理解？",
    "3. 画面中的主体要发生什么变化？",
    "4. 镜头最后停留在什么结果上？",
    "5. 它如何承接上一镜，并自然进入下一镜？",
    "",
    "## 画面类型",
    "根据内容选择最合适的表达方式：",
    "- 人物画面：适合情绪、经历、态度和个人表达；",
    "- 场景画面：适合还原具体情境、动作和使用过程；",
    "- 真实素材：适合证据、案例、产品、界面和操作展示；",
    "- 信息图形：适合步骤、关系、比较、流程、数据和因果；",
    "- 文字动效：适合金句、关键词、概念替换和结论强调。",
    "不要为了丰富而频繁切换画面。每次变化都必须帮助观众理解内容。",
    "如果文案提到真实产品、界面、数据、案例或用户素材，但我没有提供相应内容，请标记“需要补充素材”，不要自行编造。",
    "",
    "## 时间与节奏",
    "如果上面提供了配音时间轴，时间以它为准，不要自行估算，也不要修改时间戳。每个镜头的起止时间必须落在时间轴的短语边界上，不能跨语义切开。",
    "如果上面明确写着没有可用配音时间轴，请忽略配音时间轴，不要生成或猜测任何时间戳；先按语义段落和逻辑关系完成编排。写入 shot 时将 duration 设为 0，并在 notes 标记“时长待录音后确定”。",
    "如果存在配音时间轴，duration 必须使用对应短语的结束毫秒减开始毫秒再除以 1000 得到的秒数；不要把一个镜头切过短语边界。",
    "镜头时长较长时，需要安排与旁白对应的内部变化，例如：",
    "- 主体出现；",
    "- 重点被选中或放大；",
    "- 两个方案形成对比；",
    "- 步骤逐项展开；",
    "- 信息从混乱变得清晰；",
    "- 最终结论落定。",
    "入场、呼吸动画、背景循环和字幕出现不算有效的信息变化。避免画面长时间没有新内容，也不要让动画为了动而动。",
    "",
    "## 写入字段映射",
    "不要在聊天中输出下面的表格；把这些内容写入分镜页对应字段。",
    "- 镜头：从 S001 开始连续编号，写入 visualPrompt 或 notes 开头，保持和分镜顺序一致。",
    "- 时间：有时间轴时记录对应的开始/结束毫秒并将秒数写入 duration；无时间轴时 duration=0，并写“待录音后确定”。",
    "- 配音文案：原文完整保留到 dialogue，不要擅自改写。",
    "- 画面类型、画面设计、动态变化：写入 visualPrompt，并使用“【画面类型】”“【画面设计】”“【动态变化】”标签。",
    "- 画面衔接、需要补充的素材、需要确认的视觉方向、制作难度：写入 notes，并使用对应标签。",
    "- visualPrompt 必须说明主体、构图、景别、关键元素、最终停留画面和可直接执行的画面动作。",
    "- notes 必须保留前后镜头如何通过主体、动作、方向、位置、颜色或意义衔接；不要只写“淡入淡出”。",
    "",
    "填写要求：",
    "- 画面类型：从人物、场景、真实素材、信息图形、文字动效中选择；",
    "- 动态变化：按照旁白顺序写清第一次、第二次和第三次变化；没有必要时不要强行凑数；",
    "",
    "## 全片检查",
    "完成表格后，再检查：",
    "1. 画面是否真正帮助理解文案；",
    "2. 是否存在连续重复、节奏单一的问题；",
    "3. 是否有镜头变化太少或信息过载；",
    "4. 是否使用了未经提供或无法核实的素材；",
    "5. 重要信息是否得到足够的视觉强调；",
    "6. 前后镜头是否连贯；",
    "7. 哪些镜头需要我补充素材或做出选择。",
    "",
    "最后单独列出：",
    "- 需要补充的素材；",
    "- 需要确认的视觉方向；",
    "- 制作难度较高的镜头。",
    "",
    "再次强调：先在内部生成视觉编排，再通过 update_storyboard_project 写入当前项目的分镜表格；不要把完整表格停留在聊天中，也不要直接制作图片、动画或视频。"
  ].join("\n");
}

function fillScriptFromShots() {
  const lines = project.shots.map((shot) => String(shot.dialogue || "").trim()).filter(Boolean);
  if (!lines.length) return showToast("镜头里还没有台词可以汇总", "error");
  if (project.scriptDraft.trim() && !confirm("脚本草稿里已有内容，用镜头台词覆盖它吗？")) return;
  project.scriptDraft = lines.join("\n\n");
  renderScriptPanel();
  queueSave();
  showToast(`已汇总 ${lines.length} 段台词到脚本`);
}

async function copyStoryboardPrompt() {
  if (!project) return;
  await flushSave();
  await navigator.clipboard.writeText(buildStoryboardPrompt());
  showToast("生成分镜指令已复制");
}

function coverAssets() {
  if (!project?.covers) return [];
  return Object.values(project.covers)
    .filter((cover) => cover.mediaUrl)
    .map((cover) => ({
      id: `cover-${cover.type}`,
      title: cover.type === "horizontal" ? "横屏封面" : "竖屏封面",
      type: "cover",
      mediaType: "image",
      mediaUrl: cover.mediaUrl,
      aspectRatio: cover.type === "horizontal" ? "16 / 9" : "9 / 16",
      description: cover.title || cover.prompt || "短视频封面"
    }));
}

function shotAssets() {
  return (project?.shots || []).map((shot, index) => ({
    id: shot.id,
    title: `镜头 ${String(index + 1).padStart(2, "0")}`,
    type: "shot",
    shot,
    shotIndex: index,
    rollType: shot.rollType,
    mediaType: shot.mediaUrl ? shot.mediaType : "image",
    sourceMediaType: shot.mediaType,
    mediaUrl: shot.mediaUrl || (shot.rollType === "A-ROLL" ? arollPlaceholderUrl : ""),
    aspectRatio: project.aspectRatio.replace(":", " / "),
    isPlaceholder: !shot.mediaUrl,
    description: shot.visualPrompt || shot.dialogue || shot.notes || "暂无描述"
  }));
}

function projectAssets() {
  return [...coverAssets(), ...shotAssets()];
}

function renderAssetsPanel() {
  document.querySelectorAll("[data-asset-filter]").forEach((button) => {
    const selected = button.dataset.assetFilter === activeAssetFilter;
    button.setAttribute("aria-selected", String(selected));
  });
  // 这一页只看已经做出来的素材：没有文件的镜头（含 A-ROLL 占位）不列出。
  const assets = projectAssets().filter((item) => !item.isPlaceholder).filter((item) => {
    if (activeAssetFilter === "all") return true;
    if (activeAssetFilter === "cover") return item.type === "cover";
    return item.type === "shot" && item.mediaType === activeAssetFilter;
  });

  assetsGrid.replaceChildren();
  if (assets.length === 0) {
    const empty = document.createElement("div");
    empty.className = "assets-empty";
    empty.textContent = project.shots.some((shot) => shot.mediaUrl) || coverAssets().length
      ? "当前筛选下暂无素材。"
      : "还没有素材。在「分镜」页上传或生成后，会出现在这里。";
    assetsGrid.append(empty);
    return;
  }

  assets.forEach((item) => {
    const card = document.createElement("article");
    card.className = "asset-card";
    if (item.isPlaceholder) card.classList.add("is-placeholder");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "asset-preview";
    button.style.aspectRatio = item.aspectRatio;
    if (item.mediaUrl) {
      const media = item.mediaType === "video"
        ? Object.assign(document.createElement("video"), { muted: true, preload: "metadata" })
        : document.createElement("img");
      media.src = item.mediaUrl;
      media.alt = item.description;
      media.addEventListener("error", () => replaceWithMissing(media), { once: true });
      button.append(media);
      button.addEventListener("click", () => openAssetPreview(item));
    } else {
      const empty = document.createElement("span");
      empty.className = "empty-preview";
      empty.textContent = "等待素材";
      button.append(empty);
      button.disabled = true;
    }
    const kind = document.createElement("span");
    kind.className = "media-kind";
    kind.textContent = item.type === "cover"
      ? "COVER"
      : item.mediaType === "video" ? "VIDEO" : "IMAGE";
    button.append(kind);

    const bodyElement = document.createElement("div");
    bodyElement.className = "asset-card-body";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const meta = document.createElement("span");
    meta.textContent = item.type === "cover"
      ? "封面素材"
      : `${item.rollType} · ${selectLabel("mediaType", item.sourceMediaType)}`;
    bodyElement.append(title, meta);
    if (item.type === "shot") {
      const state = document.createElement("span");
      state.className = "asset-state";
      state.dataset.status = item.shot.mediaUrl ? "ready" : (item.shot.generationStatus || "idle");
      state.textContent = item.shot.mediaUrl ? "已完成" : generationLabel(item.shot);
      bodyElement.append(state);
    }
    card.append(button, bodyElement);
    assetsGrid.append(card);
  });
}

function openAssetPreview(item) {
  if (item.type === "shot" && !item.isPlaceholder) return openLightbox(item.shot, item.shotIndex);
  lightboxShotId = "";
  lightboxStage.replaceChildren();
  const image = document.createElement("img");
  image.src = item.mediaUrl;
  image.alt = item.description;
  lightboxStage.append(image);
  document.querySelector("#lightbox-caption").textContent = item.isPlaceholder
    ? `${item.title} · A-ROLL 占位`
    : item.title;
  document.querySelector("#lightbox-upload").hidden = true;
  lightbox.hidden = false;
  document.body.classList.add("lightbox-open");
  document.querySelector("#lightbox-close").focus();
}

function replaceWithMissing(media) {
  const missing = document.createElement("span");
  missing.className = "empty-preview";
  missing.textContent = "素材文件缺失";
  media.replaceWith(missing);
}

function renderPreview(shot, index) {
  const frame = document.createElement("div");
  frame.className = "preview-frame";
  frame.style.aspectRatio = project.aspectRatio.replace(":", " / ");
  const [ratioWidth, ratioHeight] = project.aspectRatio.split(":").map(Number);
  if (ratioWidth < ratioHeight) frame.classList.add("portrait-preview");

  const preview = document.createElement("button");
  preview.type = "button";
  preview.className = "preview";
  frame.append(preview);

  if (!shot.mediaUrl) {
    if (shot.rollType === "A-ROLL") {
      const image = document.createElement("img");
      image.src = arollPlaceholderUrl;
      image.alt = `镜头 ${index + 1} A-ROLL 口播占位`;
      preview.classList.add("aroll-placeholder");
      preview.append(image);
      const label = document.createElement("span");
      label.className = "media-kind";
      label.textContent = "A-ROLL";
      preview.append(label);
      if (shot.generator === "manual") {
        preview.classList.add("is-uploadable");
        preview.addEventListener("click", () => chooseUpload(shot.id));
      } else {
        preview.disabled = true;
      }
      return frame;
    }
    const empty = document.createElement("span");
    empty.className = "empty-preview";
    empty.textContent = shot.generator === "manual"
      ? "点击上传图片/视频"
      : shot.mediaType === "video" ? "等待视频素材" : "等待图片素材";
    preview.append(empty);
    if (shot.generator === "manual") {
      preview.classList.add("is-uploadable");
      preview.addEventListener("click", () => chooseUpload(shot.id));
    } else {
      preview.disabled = true;
    }
    return frame;
  }

  const media = shot.mediaType === "video"
    ? Object.assign(document.createElement("video"), { muted: true, preload: "metadata" })
    : document.createElement("img");
  media.src = shot.mediaUrl;
  media.alt = shot.visualPrompt || `镜头 ${index + 1} 素材`;
  media.addEventListener("error", () => replaceWithMissing(media), { once: true });
  preview.append(media);

  const label = document.createElement("span");
  label.className = "media-kind";
  label.textContent = shot.mediaType === "video" ? "VIDEO" : "IMAGE";
  preview.append(label);
  preview.addEventListener("click", () => openLightbox(shot, index));

  if (shot.generationStatus !== "processing") {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-media";
    removeButton.setAttribute("aria-label", "删除素材");
    removeButton.title = "删除素材";
    removeButton.textContent = "×";
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteMedia(shot);
    });
    frame.append(removeButton);
  }
  return frame;
}

function chooseUpload(shotId) {
  uploadShotId = shotId;
  mediaUpload.value = "";
  mediaUpload.click();
}

async function uploadMedia(file) {
  if (!project || !uploadShotId || !file) return;
  const form = new FormData();
  form.append("file", file);
  saveStatus.textContent = "上传中…";
  try {
    project = await api(
      `/api/projects/${encodeURIComponent(project.id)}/shots/${encodeURIComponent(uploadShotId)}/media`,
      { method: "POST", body: form }
    );
    closeLightbox();
    renderStoryboard();
    saveStatus.textContent = "已保存";
    showToast("素材已上传");
  } catch (error) {
    saveStatus.textContent = "上传失败";
    showToast(error.message, "error");
  }
}

async function deleteMedia(shot) {
  saveStatus.textContent = "删除素材…";
  try {
    project = await api(
      `/api/projects/${encodeURIComponent(project.id)}/shots/${encodeURIComponent(shot.id)}/media`,
      { method: "DELETE" }
    );
    closeLightbox();
    renderStoryboard();
    saveStatus.textContent = "已保存";
    showToast("素材已删除");
  } catch (error) {
    saveStatus.textContent = "删除失败";
    showToast(error.message, "error");
  }
}

function renderCoverPanel() {
  if (!project) return;
  ensureCovers();
  const cover = project.covers[activeCoverType];
  const isHorizontal = activeCoverType === "horizontal";

  document.querySelectorAll("[data-cover-type]").forEach((button) => {
    const selected = button.dataset.coverType === activeCoverType;
    button.setAttribute("aria-selected", String(selected));
  });
  coverPreviewFrame.dataset.coverType = activeCoverType;
  coverPreset.value = cover.preset || "custom";
  coverTitle.value = cover.title || "";
  coverPrompt.value = cover.prompt || "";
  coverPromptField.hidden = !coverUsesCustomPrompt(cover);
  coverStatus.textContent = coverGenerationLabel(cover);
  coverStatus.dataset.status = cover.generationStatus || "idle";
  coverStatus.title = cover.generationError || "";
  document.querySelector("#generate-cover").textContent = coverGenerateLabel(cover);
  document.querySelector("#generate-cover").disabled =
    (!["pending", "processing"].includes(cover.generationStatus) && !canGenerateCover(cover));
  document.querySelector("#delete-cover").disabled =
    cover.generationStatus === "processing" || !cover.mediaUrl;
  document.querySelector("#delete-cover-reference").disabled =
    cover.generationStatus === "processing" || !cover.referenceUrl;
  document.querySelector("#cover-folder-hint").textContent =
    `生成或上传后保存为 ${isHorizontal ? "cover-horizontal.png" : "cover-vertical.png"}，可在项目素材目录直接取用。`;

  coverReferencePreview.replaceChildren();
  if (cover.referenceUrl) {
    const image = document.createElement("img");
    image.src = cover.referenceUrl;
    image.alt = "封面参考图";
    coverReferencePreview.append(image);
  } else {
    const empty = document.createElement("span");
    empty.textContent = "未上传参考图";
    coverReferencePreview.append(empty);
  }

  coverPreview.replaceChildren();
  if (!cover.mediaUrl) {
    const empty = document.createElement("span");
    empty.className = "empty-preview";
    empty.textContent = isHorizontal ? "等待横屏封面" : "等待竖屏封面";
    coverPreview.append(empty);
    coverPreview.disabled = true;
    return;
  }

  const image = document.createElement("img");
  image.src = cover.mediaUrl;
  image.alt = cover.title || "短视频封面";
  coverPreview.disabled = false;
  coverPreview.append(image);
  const label = document.createElement("span");
  label.className = "media-kind";
  label.textContent = "COVER";
  coverPreview.append(label);
}

function openCoverPanel() {
  closeDesignMenu(true);
  ensureCovers();
  coverPanel.hidden = false;
  document.body.classList.add("lightbox-open");
  renderCoverPanel();
}

function closeCoverPanel() {
  coverPanel.hidden = true;
  document.body.classList.remove("lightbox-open");
}

async function uploadCover(file) {
  if (!project || !file) return;
  const form = new FormData();
  form.append("file", file);
  saveStatus.textContent = "上传封面…";
  try {
    project = await api(
      `/api/projects/${encodeURIComponent(project.id)}/covers/${activeCoverType}/media`,
      { method: "POST", body: form }
    );
    renderCoverPanel();
    saveStatus.textContent = "已保存";
    showToast("封面已上传");
  } catch (error) {
    saveStatus.textContent = "上传失败";
    showToast(error.message, "error");
  }
}

async function uploadCoverReference(file) {
  if (!project || !file) return;
  const form = new FormData();
  form.append("file", file);
  saveStatus.textContent = "上传参考图…";
  try {
    project = await api(
      `/api/projects/${encodeURIComponent(project.id)}/covers/${activeCoverType}/reference`,
      { method: "POST", body: form }
    );
    renderCoverPanel();
    saveStatus.textContent = "已保存";
    showToast("参考图已上传");
  } catch (error) {
    saveStatus.textContent = "上传失败";
    showToast(error.message, "error");
  }
}

async function deleteCoverReference() {
  if (!project) return;
  saveStatus.textContent = "删除参考图…";
  try {
    project = await api(
      `/api/projects/${encodeURIComponent(project.id)}/covers/${activeCoverType}/reference`,
      { method: "DELETE" }
    );
    renderCoverPanel();
    saveStatus.textContent = "已保存";
    showToast("参考图已删除");
  } catch (error) {
    saveStatus.textContent = "删除失败";
    showToast(error.message, "error");
  }
}

async function deleteCover() {
  if (!project) return;
  saveStatus.textContent = "删除封面…";
  try {
    project = await api(
      `/api/projects/${encodeURIComponent(project.id)}/covers/${activeCoverType}/media`,
      { method: "DELETE" }
    );
    renderCoverPanel();
    saveStatus.textContent = "已保存";
    showToast("封面已删除");
  } catch (error) {
    saveStatus.textContent = "删除失败";
    showToast(error.message, "error");
  }
}

async function queueCoverGeneration(force = false) {
  if (!project) return;
  ensureCovers();
  const cover = project.covers[activeCoverType];
  if (cover.generationStatus === "pending") return cancelCoverGeneration(cover);
  if (cover.generationStatus === "processing") {
    if (confirm("释放此封面任务？旧结果将不再回填。")) return cancelCoverGeneration(cover);
    return;
  }
  if (!coverUsesCustomPrompt(cover)) {
    cover.prompt = coverPresetByValue(cover.preset).buildPrompt(coverPromptContext());
  }
  saveStatus.textContent = "提交封面生成任务…";
  try {
    await flushSave();
    const result = await api("/api/generation/tasks", {
      method: "POST",
      body: JSON.stringify({ projectId: project.id, coverTypes: [activeCoverType], force })
    });
    project = result.project;
    renderCoverPanel();
    saveStatus.textContent = result.queued.length > 0 ? "已提交封面生成任务" : "封面任务已在队列中";
  } catch (error) {
    saveStatus.textContent = "提交失败";
    showToast(error.message, "error");
  }
}

async function cancelCoverGeneration(cover) {
  try {
    await flushSave();
    saveStatus.textContent = "取消封面生成任务…";
    const result = await api(
      `/api/generation/tasks/${encodeURIComponent(cover.generationTaskId)}/cancel`,
      { method: "POST", body: JSON.stringify({}) }
    );
    project = result.project;
    renderCoverPanel();
    saveStatus.textContent = "已取消封面生成任务";
  } catch (error) {
    project = await api(`/api/projects/${encodeURIComponent(project.id)}`);
    renderCoverPanel();
    saveStatus.textContent = "取消失败";
    showToast(error.message, "error");
  }
}

async function openMediaFolder() {
  if (!project) return;
  closeDesignMenu(true);
  try {
    const result = await api(`/api/projects/${encodeURIComponent(project.id)}/media-folder`, {
      method: "POST",
      body: JSON.stringify({})
    });
    showToast(`已打开素材目录：${result.path}`);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function openLightbox(shot, index) {
  lightboxShotId = shot.id;
  lightboxStage.replaceChildren();
  document.querySelector("#lightbox-upload").hidden = false;
  const media = shot.mediaType === "video"
    ? Object.assign(document.createElement("video"), { controls: true, autoplay: true })
    : document.createElement("img");
  media.src = shot.mediaUrl;
  media.alt = shot.visualPrompt || `镜头 ${index + 1} 素材`;
  lightboxStage.append(media);
  document.querySelector("#lightbox-caption").textContent =
    `镜头 ${String(index + 1).padStart(2, "0")} · ${shot.mediaType === "video" ? "视频" : "图片"}`;
  lightbox.hidden = false;
  document.body.classList.add("lightbox-open");
  document.querySelector("#lightbox-close").focus();
}

function closeLightbox() {
  if (lightbox.hidden) return;
  lightboxStage.querySelector("video")?.pause();
  lightbox.hidden = true;
  lightboxStage.replaceChildren();
  lightboxShotId = "";
  document.querySelector("#lightbox-upload").hidden = false;
  document.body.classList.remove("lightbox-open");
}

function buildPresenterItems() {
  return (project?.shots || []).map((shot, index) => ({
    id: shot.id,
    title: `第 ${index + 1} 镜`,
    index,
    rollType: shot.rollType,
    mediaType: shot.mediaType,
    mediaUrl: shot.mediaUrl || (shot.rollType === "A-ROLL" ? arollPlaceholderUrl : ""),
    isPlaceholder: !shot.mediaUrl,
    description: shot.visualPrompt || shot.dialogue || shot.notes || "这一镜还没有内容描述。"
  }));
}

function renderPresenter() {
  const item = presenterItems[presenterIndex];
  if (!item) return closePresenter();
  presenterStage.querySelector("video")?.pause();
  presenterStage.replaceChildren();
  document.querySelector("#presenter-project").textContent = project.title;
  document.querySelector("#presenter-title").textContent = item.title;
  document.querySelector("#presenter-kind").textContent = item.rollType;
  document.querySelector("#presenter-counter").textContent =
    `${presenterIndex + 1} / ${presenterItems.length}`;
  document.querySelector("#presenter-description").textContent = item.description;

  if (item.mediaUrl) {
    const media = item.mediaType === "video" && !item.isPlaceholder
      ? Object.assign(document.createElement("video"), { controls: true, autoplay: true })
      : document.createElement("img");
    media.src = item.mediaUrl;
    media.alt = item.description;
    presenterStage.append(media);
  } else {
    const empty = document.createElement("div");
    empty.className = "presenter-empty";
    empty.textContent = "等待素材";
    presenterStage.append(empty);
  }

  presenterStrip.replaceChildren();
  presenterItems.forEach((nextItem, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "presenter-thumb";
    button.setAttribute("aria-current", String(index === presenterIndex));
    if (nextItem.mediaUrl) {
      const media = nextItem.mediaType === "video" && !nextItem.isPlaceholder
        ? Object.assign(document.createElement("video"), { muted: true, preload: "metadata" })
        : document.createElement("img");
      media.src = nextItem.mediaUrl;
      media.alt = nextItem.title;
      button.append(media);
    } else {
      const empty = document.createElement("span");
      empty.textContent = String(index + 1).padStart(2, "0");
      button.append(empty);
    }
    const label = document.createElement("small");
    label.textContent = `${index + 1}`;
    button.append(label);
    button.addEventListener("click", () => {
      presenterIndex = index;
      renderPresenter();
    });
    presenterStrip.append(button);
  });
}

function openPresenter() {
  if (!project) return;
  presenterItems = buildPresenterItems();
  if (presenterItems.length === 0) {
    showToast("当前项目还没有镜头", "error");
    return;
  }
  presenterIndex = 0;
  presenter.hidden = false;
  document.body.classList.add("lightbox-open");
  renderPresenter();
  document.querySelector("#presenter-close").focus();
}

function closePresenter() {
  if (presenter.hidden) return;
  presenterStage.querySelector("video")?.pause();
  presenter.hidden = true;
  presenterStage.replaceChildren();
  presenterStrip.replaceChildren();
  document.body.classList.remove("lightbox-open");
}

function movePresenter(offset) {
  if (presenter.hidden || presenterItems.length === 0) return;
  presenterIndex = (presenterIndex + offset + presenterItems.length) % presenterItems.length;
  renderPresenter();
}

function selectLabel(field, value) {
  return selectOptions[field].find((option) => option.value === value)?.label || value;
}

function closeSelect({ restoreFocus = false } = {}) {
  if (!activeSelect) return;
  activeSelect.menu.remove();
  activeSelect.trigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) activeSelect.trigger.focus();
  activeSelect = null;
}

function positionMenu(trigger, menu) {
  const rect = trigger.getBoundingClientRect();
  const gap = 5;
  const roomBelow = window.innerHeight - rect.bottom;
  const top = roomBelow >= menu.offsetHeight + gap
    ? rect.bottom + gap
    : Math.max(8, rect.top - menu.offsetHeight - gap);
  menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${top}px`;
  const contentWidth = menu.scrollWidth || 120;
  menu.style.width = `${Math.max(rect.width, Math.min(contentWidth + 10, 200))}px`;
}

function openSelect(trigger, field, shot, onChange) {
  if (activeSelect?.trigger === trigger) return closeSelect({ restoreFocus: true });
  closeSelect();
  const menu = document.createElement("div");
  menu.className = "select-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", trigger.getAttribute("aria-label"));
  const options = selectOptions[field];

  options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "select-option";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(option.value === shot[field]));
    button.dataset.index = String(index);
    button.textContent = option.label;
    if (option.hint) button.title = option.hint;
    button.addEventListener("click", () => {
      onChange(option.value);
      closeSelect({ restoreFocus: true });
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Escape") return closeSelect({ restoreFocus: true });
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = event.key === "ArrowDown"
          ? Math.min(index + 1, options.length - 1)
          : Math.max(index - 1, 0);
        menu.querySelector(`[data-index="${next}"]`)?.focus();
      }
    });
    menu.append(button);
  });

  selectPortal.append(menu);
  trigger.setAttribute("aria-expanded", "true");
  activeSelect = { trigger, menu };
  positionMenu(trigger, menu);
  menu.querySelector('[aria-selected="true"]')?.focus();
}

function updateSelectTrigger(trigger, field, value) {
  const label = trigger.querySelector(".select-value");
  label.className = `select-value ${
    field === "rollType" ? (value === "A-ROLL" ? "roll-a" : "roll-b") : ""
  }`;
  label.textContent = selectLabel(field, value);
}

function renderSelect(container, field, shot, onChange) {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", {
    rollType: "镜头类型",
    mediaType: "媒体类型",
    generator: "生成方式"
  }[field]);
  const value = document.createElement("span");
  value.className = `select-value ${
    field === "rollType" ? (shot[field] === "A-ROLL" ? "roll-a" : "roll-b") : ""
  }`;
  value.textContent = selectLabel(field, shot[field]);
  const chevron = document.createElement("span");
  chevron.className = "select-chevron";
  trigger.append(value, chevron);
  const activate = () => openSelect(trigger, field, shot, (nextValue) => {
    shot[field] = nextValue;
    updateSelectTrigger(trigger, field, nextValue);
    onChange(field);
  });
  trigger.addEventListener("click", activate);
  trigger.addEventListener("keydown", (event) => {
    if (["ArrowDown", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      activate();
    }
  });
  container.replaceChildren(trigger);
}

function updateSummary() {
  const warnings = inspectPacingDetailed(project.shots);
  const summary = document.querySelector("#pacing-summary");
  summary.textContent = warnings.length ? `节奏检查 · ${warnings.length} 条建议` : "节奏检查 · 无明显异常";
  summary.dataset.state = warnings.length ? "warn" : "ok";
  document.querySelector("#pacing-results").replaceChildren(...warnings.map(({ message, indexes }) => {
    const item = document.createElement("li");
    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "pacing-jump";
    jump.textContent = message;
    jump.addEventListener("click", () => focusShotRow(indexes[0]));
    item.append(jump);
    return item;
  }));
  body.querySelectorAll(".shot-row").forEach((row, index) => {
    const messages = warnings.filter((item) => item.indexes.includes(index)).map((item) => item.message);
    const flag = row.querySelector(".pacing-flag");
    flag.hidden = messages.length === 0;
    flag.title = messages.join("\n");
  });
  durationTotal.textContent = formatDuration(
    project.shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0)
  );
}

function queueSave() {
  autosave.schedule();
}

async function flushSave() {
  if (!await autosave.flush()) throw new Error("尚有未保存的修改，请重试保存后继续");
}

const autosave = createAutosave({
  read: () => project,
  write: (snapshot) => api(`/api/projects/${encodeURIComponent(snapshot.id)}`, {
      method: "PUT",
      body: JSON.stringify(snapshot)
    }),
  onSaved: (saved) => {
    if (project?.id !== saved.id) return;
    project.updatedAt = saved.updatedAt;
    // 调整顺序后服务端会同步素材文件名，这里跟上新的地址，避免预览变成破图。
    const urls = new Map(saved.shots.map((shot) => [shot.id, shot.mediaUrl]));
    let changed = false;
    for (const shot of project.shots) {
      if (urls.has(shot.id) && urls.get(shot.id) !== shot.mediaUrl) { shot.mediaUrl = urls.get(shot.id); changed = true; }
    }
    if (changed) restoreFocusAfter(renderStoryboard);
  },
  onState: (state) => { saveStatus.dataset.state = state; saveStatus.textContent = ({ dirty: "待保存", saving: "保存中…", saved: "已保存", error: "保存失败，点击重试" })[state]; },
  onError: (error) => showToast(error.message, "error")
});
saveStatus.addEventListener("click", () => autosave.flush());
window.addEventListener("beforeunload", (event) => {
  if (autosave.dirty) { event.preventDefault(); event.returnValue = ""; }
});
window.addEventListener("online", () => autosave.flush());

function restoreFocusAfter(action) {
  const active = document.activeElement;
  const id = active?.closest?.(".shot-row")?.dataset.id;
  const field = active?.dataset?.field;
  const selection = field && "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : null;
  action();
  if (!id || !field) return;
  const target = body.querySelector(`.shot-row[data-id="${id}"] [data-field="${field}"]`);
  if (!target) return;
  target.focus({ preventScroll: true });
  if (selection) target.setSelectionRange(...selection);
}

function flashShot(id) {
  const row = body.querySelector(`.shot-row[data-id="${id}"]`);
  if (!row) return;
  row.classList.remove("row-flash");
  void row.offsetWidth;
  row.classList.add("row-flash");
}

function reorderShots(from, to) {
  const next = moveShot(project.shots, from, to);
  if (next === project.shots) return;
  const movedId = project.shots[from].id;
  restoreFocusAfter(() => { project.shots = next; renderStoryboard(); });
  queueSave();
  flashShot(movedId);
  body.querySelector(`.shot-row[data-id="${movedId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function duplicateShotAt(index) {
  const copy = cloneShot(project.shots[index]);
  project.shots.splice(index + 1, 0, copy);
  renderStoryboard();
  queueSave();
  focusShotRow(index + 1);
  showToast(`已复制镜头 ${index + 1}（不含素材）`);
}

function insertShotAfter(index) {
  const shot = { ...emptyShot(), id: newShotId(), rollType: project.shots[index]?.rollType || "B-ROLL" };
  project.shots.splice(index + 1, 0, shot);
  renderStoryboard();
  queueSave();
  focusShotRow(index + 1);
  body.children[index + 1]?.querySelector('[data-field="dialogue"]')?.focus({ preventScroll: true });
}

function removeShotAt(index) {
  const [removed] = project.shots.splice(index, 1);
  const hadMedia = Boolean(removed.mediaUrl);
  renderStoryboard();
  queueSave();
  showToast(hadMedia ? `已删除镜头 ${index + 1}，其素材文件不再保留` : `已删除镜头 ${index + 1}`, "info", {
    label: hadMedia ? "撤销（仅文案）" : "撤销",
    run: () => {
      // 删除后其余镜头的素材文件会按新顺序改名，原素材无法原样恢复，只恢复文案与设置。
      const restored = hadMedia ? cloneShot(removed, removed.id) : removed;
      project.shots.splice(Math.min(index, project.shots.length), 0, restored);
      renderStoryboard();
      queueSave();
      focusShotRow(Math.min(index, project.shots.length - 1));
    }
  });
}

function openRowMenu(trigger, index) {
  if (activeSelect?.trigger === trigger) return closeSelect({ restoreFocus: true });
  closeSelect();
  const menu = document.createElement("div");
  menu.className = "select-menu row-menu-popover";
  menu.setAttribute("role", "menu");
  const last = project.shots.length - 1;
  const items = [
    { label: "上移", disabled: index === 0, run: () => reorderShots(index, index - 1) },
    { label: "下移", disabled: index === last, run: () => reorderShots(index, index + 1) },
    { label: "复制镜头", run: () => duplicateShotAt(index) },
    { label: "在下方插入镜头", run: () => insertShotAfter(index) },
    { label: "删除镜头", danger: true, run: () => removeShotAt(index) }
  ];
  items.forEach((item, position) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "select-option";
    button.setAttribute("role", "menuitem");
    button.disabled = Boolean(item.disabled);
    if (item.danger) button.dataset.danger = "true";
    button.textContent = item.label;
    button.addEventListener("click", () => { closeSelect(); item.run(); });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Escape") return closeSelect({ restoreFocus: true });
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const enabled = [...menu.querySelectorAll("button:not(:disabled)")];
      const at = enabled.indexOf(button);
      enabled[(at + (event.key === "ArrowDown" ? 1 : enabled.length - 1)) % enabled.length]?.focus();
    });
    menu.append(button);
    if (position === items.length - 2) menu.append(Object.assign(document.createElement("div"), { className: "menu-separator" }));
  });
  selectPortal.append(menu);
  trigger.setAttribute("aria-expanded", "true");
  activeSelect = { trigger, menu };
  positionMenu(trigger, menu);
  menu.querySelector("button:not(:disabled)")?.focus();
}

function applyShotFilter() {
  let shown = 0;
  body.querySelectorAll(".shot-row").forEach((row, index) => {
    const match = shotMatches(project.shots[index], shotQuery);
    row.hidden = !match;
    if (match) shown++;
  });
  const none = body.querySelector(".no-match-row");
  if (none) none.hidden = shown > 0 || project.shots.length === 0;
}

function applyDensity() {
  document.querySelector(".table-shell").dataset.density = density;
  document.querySelectorAll("[data-density]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.density === density));
  });
}

function attachRowDrag(row, shot) {
  const handle = row.querySelector(".drag-handle");
  const stop = () => { row.draggable = false; };
  handle.addEventListener("pointerdown", () => { row.draggable = true; });
  handle.addEventListener("pointerup", stop);
  row.addEventListener("dragstart", (event) => {
    if (!row.draggable) return;
    dragShotId = shot.id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", shot.id);
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", () => {
    stop();
    dragShotId = "";
    row.classList.remove("dragging");
    body.querySelectorAll("[data-drop]").forEach((item) => delete item.dataset.drop);
  });
  row.addEventListener("dragover", (event) => {
    if (!dragShotId || dragShotId === shot.id) return;
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    body.querySelectorAll("[data-drop]").forEach((item) => { if (item !== row) delete item.dataset.drop; });
    row.dataset.drop = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
    const shell = document.querySelector(".table-shell");
    const box = shell.getBoundingClientRect();
    if (event.clientY < box.top + 70) shell.scrollTop -= 18;
    else if (event.clientY > box.bottom - 70) shell.scrollTop += 18;
  });
  row.addEventListener("dragleave", (event) => {
    if (!row.contains(event.relatedTarget)) delete row.dataset.drop;
  });
  row.addEventListener("drop", (event) => {
    if (!dragShotId) return;
    event.preventDefault();
    const after = row.dataset.drop === "after";
    delete row.dataset.drop;
    const from = project.shots.findIndex((item) => item.id === dragShotId);
    const target = project.shots.findIndex((item) => item.id === shot.id);
    if (from < 0 || target < 0) return;
    let to = target + (after ? 1 : 0);
    if (from < to) to--;
    reorderShots(from, to);
  });
}

function renderStoryboard() {
  renderVoice();
  closeSelect();
  ensureCovers();
  project.scriptDraft = String(project.scriptDraft || "");
  document.title = `${project.title} · Agent 分镜台`;
  document.querySelector("#project-title").textContent = project.title;
  document.querySelector("#project-ratio").textContent = project.aspectRatio;
  renderProjectTabs();
  renderScriptPanel();
  renderDesignState();
  document.documentElement.style.setProperty("--preview-ratio", project.aspectRatio.replace(":", " / "));
  body.replaceChildren();

  project.shots.forEach((shot, index) => {
    const row = shotTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.id = shot.id;
    row.querySelector(".row-index").textContent = String(index + 1).padStart(2, "0");

    row.querySelectorAll("[data-field]").forEach((control) => {
      const field = control.dataset.field;
      control.value = shot[field];
      control.addEventListener("input", () => {
        shot[field] = field === "duration" ? Number(control.value) : control.value;
        updateSummary();
        if (field === "visualPrompt") {
          updateBatchButton();
          const generateButton = row.querySelector(".generate-shot");
          generateButton.textContent = generationButtonLabel(shot);
          generateButton.disabled =
            shot.generationStatus === "processing" ||
            (shot.generationStatus !== "pending" && !shot.visualPrompt.trim());
        }
        queueSave();
      });
    });

    row.querySelectorAll("[data-select-field]").forEach((container) => {
      const field = container.dataset.selectField;
      renderSelect(container, field, shot, (changedField) => {
        if (changedField === "generator" || changedField === "mediaType" || changedField === "rollType") renderStoryboard();
        queueSave();
      });
    });

    row.querySelector(".preview-slot").append(renderPreview(shot, index));
    const status = row.querySelector(".generation-status");
    status.textContent = generationLabel(shot);
    status.dataset.status = shot.generationStatus || "idle";
    status.title = shot.generationError || "";

    const generateButton = row.querySelector(".generate-shot");
    generateButton.textContent = generationButtonLabel(shot);
    generateButton.disabled =
      (shot.generator !== "manual" && !shot.visualPrompt.trim());
    generateButton.dataset.action = shot.generationStatus === "pending" ? "cancel" : "generate";
    generateButton.addEventListener("click", () => {
      if (shot.generator === "manual") return chooseUpload(shot.id);
      if (shot.generationStatus === "processing") {
        if (confirm("释放此任务？外部生成进程可能仍在运行，但旧结果将不再回填。")) return cancelGeneration(shot);
        return;
      }
      if (shot.generationStatus === "pending") return cancelGeneration(shot);
      return queueGeneration(
        [shot.id],
        shot.generationStatus === "ready" || shot.generationStatus === "failed"
      );
    });

    const menuButton = row.querySelector(".row-menu");
    menuButton.addEventListener("click", () => openRowMenu(menuButton, project.shots.findIndex((item) => item.id === shot.id)));
    attachRowDrag(row, shot);
    body.append(row);
  });

  if (project.shots.length === 0) {
    const empty = document.createElement("tr");
    empty.className = "empty-row";
    empty.innerHTML = '<td colspan="10"><strong>这个项目还没有镜头</strong><span>点右上角「＋ 新增镜头」手动添加，或在脚本页写好脚本后让 Agent 拆成分镜。</span></td>';
    body.append(empty);
  } else {
    const none = document.createElement("tr");
    none.className = "no-match-row";
    none.hidden = true;
    none.innerHTML = '<td colspan="10">没有匹配的镜头</td>';
    body.append(none);
  }

  applyDensity();
  applyShotFilter();
  updateSummary();
  updateBatchButton();
  renderAssetsPanel();
  if (!coverPanel.hidden) renderCoverPanel();
}

function renderDesignState() {
  const hasDesign = Boolean(project?.hasDesign);
  designMenu.dataset.active = String(hasDesign);
  const designLight = document.querySelector("#design-light");
  designLight.dataset.active = String(hasDesign);
  designLight.title = hasDesign ? "已配置视觉规范" : "未配置视觉规范";
  document.querySelector("#view-design").hidden = !hasDesign;
  document.querySelector("#remove-design").hidden = !hasDesign;
  document.querySelector("#import-design").textContent = hasDesign
    ? "替换 DESIGN.md"
    : "导入 DESIGN.md";
}

function openDesignMenu() {
  clearTimeout(designMenuCloseTimer);
  designMenuPopover.hidden = false;
  designMenuTrigger.setAttribute("aria-expanded", "true");
}

function closeDesignMenu(force = false) {
  clearTimeout(designMenuCloseTimer);
  if (designMenuPinned && !force) return;
  designMenuPinned = false;
  designMenuPopover.hidden = true;
  designMenuTrigger.setAttribute("aria-expanded", "false");
}

function scheduleDesignMenuClose() {
  clearTimeout(designMenuCloseTimer);
  if (designMenuPinned) return;
  designMenuCloseTimer = setTimeout(() => closeDesignMenu(), 100);
}

async function uploadProjectDesign(projectId, file) {
  const form = new FormData();
  form.append("file", file);
  return api(`/api/projects/${encodeURIComponent(projectId)}/design`, {
    method: "POST",
    body: form
  });
}

async function importCurrentDesign(file) {
  if (!project || !file) return;
  const replacing = project.hasDesign;
  saveStatus.textContent = replacing ? "替换视觉规范…" : "导入视觉规范…";
  try {
    project = await uploadProjectDesign(project.id, file);
    renderDesignState();
    saveStatus.textContent = "已保存";
    showToast(replacing ? "视觉规范已更新" : "视觉规范已导入");
  } catch (error) {
    saveStatus.textContent = "导入失败";
    showToast(error.message, "error");
  }
}

async function viewCurrentDesign() {
  try {
    const result = await api(`/api/projects/${encodeURIComponent(project.id)}/design`);
    document.querySelector("#design-content").textContent = result.content;
    designDialog.showModal();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function removeCurrentDesign() {
  try {
    project = await api(`/api/projects/${encodeURIComponent(project.id)}/design`, {
      method: "DELETE"
    });
    removeDesignDialog.close();
    renderDesignState();
    saveStatus.textContent = "已保存";
    showToast("视觉规范已移除");
  } catch (error) {
    showToast(error.message, "error");
  }
}

// ── 风格库 ──

async function loadStyleData() {
  if (styleData.length) return styleData;
  try {
    const response = await fetch("/styles-data.json");
    styleData = await response.json();
  } catch {
    styleData = [];
  }
  return styleData;
}

async function loadStylesView() {
  const data = await loadStyleData();
  if (!data.length) return;
  renderStyleFilters(data);
  renderStylesGrid(data);
}

function renderStyleFilters(data) {
  const categories = [...new Set(data.map((s) => s.category))];
  const existingButtons = stylesFilters.querySelectorAll("button[data-style-filter]");
  existingButtons.forEach((b) => { if (b.dataset.styleFilter !== "all") b.remove(); });
  categories.forEach((cat) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.styleFilter = cat;
    button.textContent = cat;
    button.addEventListener("click", () => {
      activeStyleFilter = cat;
      renderStyleFiltersState();
      renderStylesGrid(data);
    });
    stylesFilters.append(button);
  });
  renderStyleFiltersState();
}

function renderStyleFiltersState() {
  document.querySelectorAll("[data-style-filter]").forEach((button) => {
    button.setAttribute("aria-current", button.dataset.styleFilter === activeStyleFilter ? "page" : "false");
  });
}

function renderStylesGrid(data) {
  const filtered = activeStyleFilter === "all"
    ? data
    : data.filter((s) => s.category === activeStyleFilter);
  stylesGrid.innerHTML = "";
  filtered.forEach((style) => {
    const card = document.createElement("article");
    card.className = "style-card";
    card.innerHTML = `
      <div class="style-card-preview" aria-hidden="true">
        <img src="/assets/styles/${style.id}.png" alt="${style.name} 风格预览" loading="lazy" />
      </div>
      <div class="style-card-body">
        <span class="style-card-category">${style.category}</span>
        <strong class="style-card-name">${style.name}</strong>
        <p class="style-card-desc">${style.description}</p>
      </div>
    `;
    card.addEventListener("click", () => openStyleDetail(style));
    stylesGrid.append(card);
  });
}

function openStyleDetail(style) {
  document.querySelector("#style-detail-category").textContent = style.category;
  document.querySelector("#style-detail-name").textContent = style.name;
  document.querySelector("#style-detail-desc").textContent = style.description;
  document.querySelector("#style-detail-content").textContent = style.designContent;
  const preview = document.querySelector("#style-detail-preview");
  preview.innerHTML = `<img src="/assets/styles/${style.id}.png" alt="${style.name} 预览" style="width:100%;border-radius:12px;display:block;" />`;
  pendingStyleId = style.id;
  styleDetailDialog.showModal();
}

async function openStyleApplyDialog() {
  targetProjectId = "";
  document.querySelector("#style-apply-name").textContent =
    styleData.find((s) => s.id === pendingStyleId)?.name || "";
  document.querySelector("#style-apply-confirm").disabled = true;
  const list = document.querySelector("#style-apply-project-list");
  list.innerHTML = "";

  let result;
  try {
    result = await api("/api/projects");
  } catch (error) {
    styleDetailDialog.close();
    showToast("获取项目列表失败，请检查服务是否正常", "error");
    return;
  }

  const projects = result.projects || result;
  if (!Array.isArray(projects) || !projects.length) {
    styleDetailDialog.close();
    showToast("还没有项目，请先创建一个项目", "info");
    return;
  }

  projects.forEach((p) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "style-apply-project-item";
    item.innerHTML = `<span>${p.title}</span><span class="style-apply-project-meta">${p.aspectRatio}</span>`;
    item.addEventListener("click", () => {
      list.querySelectorAll(".style-apply-project-item").forEach((b) =>
        b.removeAttribute("aria-selected"));
      item.setAttribute("aria-selected", "true");
      targetProjectId = p.id;
      document.querySelector("#style-apply-confirm").disabled = false;
    });
    list.append(item);
  });

  styleDetailDialog.close();
  styleApplyDialog.showModal();
}

async function applyStyleToProject() {
  if (!targetProjectId || !pendingStyleId) return;
  const style = styleData.find((s) => s.id === pendingStyleId);
  if (!style) return;
  try {
    const blob = new Blob([style.designContent], { type: "text/markdown" });
    const file = new File([blob], "DESIGN.md", { type: "text/markdown" });
    await uploadProjectDesign(targetProjectId, file);
    styleApplyDialog.close();
    navigate(`/?project=${encodeURIComponent(targetProjectId)}`);
  } catch (error) {
    showToast(`应用风格失败：${error.message}`, "error");
  }
}

async function uploadProjectDesignFromContent(projectId, content) {
  const form = new FormData();
  const blob = new Blob([content], { type: "text/markdown" });
  form.append("file", blob, "DESIGN.md");
  return api(`/api/projects/${encodeURIComponent(projectId)}/design`, {
    method: "POST",
    body: form
  });
}

async function cancelGeneration(shot) {
  try {
    await flushSave();
    saveStatus.textContent = "取消生成任务…";
    const result = await api(
      `/api/generation/tasks/${encodeURIComponent(shot.generationTaskId)}/cancel`,
      { method: "POST", body: JSON.stringify({}) }
    );
    project = result.project;
    saveStatus.textContent = "已取消生成任务";
    renderStoryboard();
  } catch (error) {
    project = await api(`/api/projects/${encodeURIComponent(project.id)}`);
    renderStoryboard();
    if (error.status === 409) {
      saveStatus.textContent = "任务已开始生成";
      showToast("任务已被 Agent 领取，无法取消", "error");
      return;
    }
    saveStatus.textContent = "取消失败";
    showToast(error.message, "error");
  }
}

async function queueGeneration(shotIds, force = false) {
  saveStatus.textContent = "提交生成任务…";
  try {
    await flushSave();
    const result = await api("/api/generation/tasks", {
      method: "POST",
      body: JSON.stringify({ projectId: project.id, shotIds, force })
    });
    project = result.project;
    saveStatus.textContent = result.queued.length > 0
      ? `已提交 ${result.queued.length} 个生成任务`
      : "任务已在队列或生成中";
    renderStoryboard();
  } catch (error) {
    saveStatus.textContent = "提交失败";
    showToast(error.message, "error");
  }
}

async function addShot() {
  await flushSave();
  project = await api(`/api/projects/${encodeURIComponent(project.id)}/shots`, {
    method: "POST",
    body: JSON.stringify(emptyShot())
  });
  renderStoryboard();
  body.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!project || autosave.dirty) return;
    const polledId = project.id;
    const polledVersion = project.updatedAt;
    try {
      const remote = await api(`/api/projects/${encodeURIComponent(project.id)}`);
      if (project?.id !== polledId || autosave.dirty || project.updatedAt !== polledVersion) return;
      if (remote.updatedAt !== project.updatedAt) {
        project = remote;
        renderStoryboard();
      }
    } catch (error) {
      if (error.status !== 404 || project?.id !== polledId || autosave.dirty) return;
      clearInterval(pollTimer);
      history.replaceState({}, "", "/");
      await showProjectsView();
      showToast("当前项目已在其他窗口中删除", "error");
    }
  }, 1500);
}

renderRatioOptions();
function renderVoice() {
  const audio = project?.audio || { takes: [] };
  const takes = Array.isArray(audio.takes) ? audio.takes : [];
  const takeIndex = takes.findIndex(item => item.id === audio.selectedId);
  const take = takeIndex >= 0 ? takes[takeIndex] : null;
  const formatDuration = value => {
    const seconds = Number(value) / 1000;
    return Number.isFinite(seconds) && seconds >= 0 ? `${seconds.toFixed(2)} 秒` : "时长未知";
  };
  const currentMeta = document.querySelector("#voice-current-meta");
  const busy = ["generating", "aligning"].includes(audio.status);
  const hasSpokenShots = Array.isArray(project?.shots) && project.shots.some(shot => String(shot.dialogue || "").trim());
  const status = document.querySelector("#voice-status");
  status.textContent = ({ generating: "生成中", aligning: "对齐中", ready: "已就绪", failed: "需要处理" })[audio.status] || "未生成";
  status.dataset.status = audio.status || "idle";
  const reference = audio.reference && typeof audio.reference === "object" ? audio.reference : null;
  const referenceName = document.querySelector("#voice-reference-name");
  const referencePlayer = document.querySelector("#voice-reference-player");
  const referenceText = document.querySelector("#voice-reference-text");
  const deleteReference = document.querySelector("#delete-voice-reference");
  referenceName.textContent = reference?.fileName ? `已上传：${reference.fileName}` : "未上传参考音频";
  deleteReference.disabled = busy || !reference?.fileName;
  if (reference?.url) {
    referencePlayer.hidden = false;
    if (referencePlayer.getAttribute("src") !== reference.url) referencePlayer.src = reference.url;
  } else {
    referencePlayer.hidden = true;
    referencePlayer.removeAttribute("src");
    referencePlayer.load();
  }
  if (document.activeElement !== referenceText) referenceText.value = reference?.text || "";
  currentMeta.textContent = take
    ? `版本 ${String(takeIndex + 1).padStart(2, "0")} · ${formatDuration(take.durationMs)}`
    : "尚未生成配音";
  document.querySelector("#voice-error").textContent = audio.error || "";
  document.querySelector("#voice-generate").disabled = busy;
  document.querySelector("#voice-align").disabled = busy || !take || !hasSpokenShots;
  document.querySelector("#voice-apply").disabled = busy || !take?.timeline?.length;
  document.querySelector("#timing-note").hidden = false;
  document.querySelector("#timing-note").textContent = !take
    ? "生成配音后，可识别台词并调整镜头时长。"
    : !hasSpokenShots
      ? "当前项目没有带台词的镜头，无法进行对齐；请先在分镜中填写台词。"
      : take.alignEngine?.startsWith("whisper")
        ? "Whisper 已完成本地识别，可试听后微调时间。无台词镜头保留原时长。"
        : "尚未完成识别，请先点击“重新识别”。";
  document.querySelector("#voice-align").textContent = take?.timeline?.length ? "重新识别" : "识别并对齐";
  document.querySelector("#timing-note").dataset.ready = String(Boolean(take?.alignEngine?.startsWith("whisper")));
  if (take?.alignEngine?.startsWith("whisper")) document.querySelector("#timing-note").textContent = "Whisper 已完成本地识别";
  renderVoicePlayer(project, busy, takeId => voiceAction("select", { takeId }));
}
async function uploadVoiceReference(file) {
  if (!project || !file) return;
  if (file.type && !["audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4a"].includes(file.type)) {
    showToast("参考音频仅支持 WAV、MP3 或 M4A", "error");
    return;
  }
  const form = new FormData();
  form.append("file", file);
  saveStatus.textContent = "上传参考音频…";
  try {
    await flushSave();
    project = await api(`/api/projects/${encodeURIComponent(project.id)}/audio/reference`, { method: "POST", body: form });
    renderStoryboard();
    saveStatus.textContent = "已保存";
    showToast("参考音频已上传");
  } catch (error) {
    saveStatus.textContent = "上传失败";
    showToast(error.message, "error");
  }
}
async function deleteVoiceReference() {
  if (!project?.audio?.reference) return;
  saveStatus.textContent = "删除参考音频…";
  try {
    await flushSave();
    project = await api(`/api/projects/${encodeURIComponent(project.id)}/audio/reference`, { method: "DELETE" });
    renderStoryboard();
    saveStatus.textContent = "已保存";
    showToast("参考音频已删除");
  } catch (error) {
    saveStatus.textContent = "删除失败";
    showToast(error.message, "error");
  }
}
async function voiceAction(action, payload = {}) {
  try {
    await flushSave();
    project = await api(`/api/projects/${encodeURIComponent(project.id)}/audio/${action}`, { method: "POST", body: JSON.stringify(payload) });
    renderStoryboard();
  } catch (error) { showToast(error.message, "error"); }
}
document.querySelector("#voice-generate").addEventListener("click", () => {
  if (!confirm("将镜头台词（无台词时使用脚本）以及已上传的参考音频（如有）发送到 VoxCPM 在线服务生成配音，继续？")) return;
  voiceAction("generate", {
    instruction: document.querySelector("#voice-instruction").value,
    referenceText: document.querySelector("#voice-reference-text").value
  });
});
document.querySelector("#voice-align").addEventListener("click", () => voiceAction("align"));
document.querySelector("#voice-apply").addEventListener("click", () => {
  const timeline = [...document.querySelectorAll(".timing-row")].map(row => ({
    shotId: row.dataset.shotId, text: row.querySelector("span").textContent,
    start: Math.round(Number(row.querySelector('[data-time-key="start"]').value) * 1000),
    end: Math.round(Number(row.querySelector('[data-time-key="end"]').value) * 1000)
  }));
  if (confirm("将覆盖有台词镜头的时长，无台词镜头保持不变。继续？")) voiceAction("apply-durations", { timeline });
});
document.querySelector("#environment-check").addEventListener("click", async () => {
  const dialog = document.querySelector("#environment-dialog");
  const results = document.querySelector("#environment-results");
  const summaryTitle = document.querySelector("#environment-summary-title");
  const summaryDetail = document.querySelector("#environment-summary-detail");
  const summaryDot = document.querySelector("#environment-summary-dot");
  summaryTitle.textContent = "检查中…";
  summaryDetail.textContent = "正在检查配音服务、FFmpeg 和本机 Agent";
  summaryDot.dataset.status = "loading";
  results.replaceChildren();
  dialog.showModal();
  try {
    const result = await api("/api/environment");
    summaryTitle.textContent = result.summary.title;
    summaryDetail.textContent = result.summary.detail;
    summaryDot.dataset.status = result.summary.state === "ready" ? "ready" : "missing";
    const stateLabel = { ready: "正常", missing: "需要处理", info: "未检测到" };
    results.replaceChildren(...result.groups.map((group) => {
      const section = document.createElement("section");
      section.className = "environment-group";
      const title = document.createElement("h3");
      title.textContent = group.title;
      section.append(title, ...group.items.map((item) => {
        const row = document.createElement("div");
        row.className = "environment-row";
        row.dataset.status = item.status;
        const heading = document.createElement("div");
        heading.className = "environment-row-heading";
        const name = document.createElement("strong");
        name.textContent = item.name;
        const state = document.createElement("span");
        state.className = "environment-state";
        state.textContent = stateLabel[item.status] || item.status;
        heading.append(name, state);
        const detail = document.createElement("small");
        detail.textContent = item.detail;
        row.append(heading, detail);
        return row;
      }));
      return section;
    }));
  } catch (error) {
    summaryTitle.textContent = "检查失败";
    summaryDetail.textContent = error.message;
    summaryDot.dataset.status = "missing";
  }
});
renderCoverPresetOptions();
updateThemeButtons();

themeButtons.forEach((button) => button.addEventListener("click", toggleTheme));
document.querySelector("#create-project").addEventListener("click", () => openProjectDialog("create"));
document.querySelector("#brand-home").addEventListener("click", () => navigate("/"));
document.querySelector("#back-home").addEventListener("click", () => navigate("/"));
document.querySelector("#add-shot-top").addEventListener("click", addShot);
document.querySelector("#present-project").addEventListener("click", openPresenter);
document.querySelector("#copy-storyboard-prompt").addEventListener("click", copyStoryboardPrompt);
document.querySelector("#fill-script-from-shots").addEventListener("click", fillScriptFromShots);
document.querySelector("#open-cover-top").addEventListener("click", openCoverPanel);
document.querySelector("#project-search").addEventListener("input", (event) => {
  projectQuery = event.target.value.trim();
  renderProjects();
});
document.querySelector("#shot-search").addEventListener("input", (event) => {
  shotQuery = event.target.value;
  if (project) applyShotFilter();
});
document.querySelectorAll("[data-density]").forEach((button) => {
  button.addEventListener("click", () => {
    density = button.dataset.density;
    writePreference("codex-storyboard-density", density);
    applyDensity();
  });
});
document.querySelector("#task-chip").addEventListener("click", () => {
  if (!project) return;
  const order = ["failed", "processing", "pending"];
  for (const status of order) {
    const index = project.shots.findIndex((shot) => shot.generator !== "manual" && shot.generationStatus === status);
    if (index >= 0) { activeProjectTab = "storyboard"; renderProjectTabs(); return focusShotRow(index); }
  }
  openCoverPanel();
});
scriptDraft.addEventListener("input", () => {
  if (!project) return;
  project.scriptDraft = scriptDraft.value;
  renderScriptPanel();
  queueSave();
});
document.querySelectorAll("[data-project-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    activeProjectTab = button.dataset.projectTab;
    renderStoryboard();
  });
});
document.querySelectorAll("[data-asset-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    activeAssetFilter = button.dataset.assetFilter;
    renderAssetsPanel();
  });
});

projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = projectNameInput.value.trim();
  if (!title) return projectNameInput.focus();

  if (dialogMode === "create") {
    const aspectRatio = new FormData(projectForm).get("aspectRatio");
    const created = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ title, aspectRatio })
    });
    projectDialog.close();
    if (pendingProjectDesign) {
      try {
        await uploadProjectDesign(created.id, pendingProjectDesign);
      } catch (error) {
        navigate(projectPath(created.id));
        showToast(`项目已创建，但视觉规范导入失败：${error.message}`, "error");
        return;
      }
    }
    navigate(projectPath(created.id));
    return;
  }

  await api(`/api/projects/${encodeURIComponent(editingProjectId)}`, {
    method: "PATCH",
    body: JSON.stringify({ title })
  });
  projectDialog.close();
  await loadProjects();
});

document.querySelector("#confirm-delete").addEventListener("click", async (event) => {
  event.preventDefault();
  await api(`/api/projects/${encodeURIComponent(deletingProjectId)}`, { method: "DELETE" });
  deleteDialog.close();
  deletingProjectId = "";
  await loadProjects();
  showToast("项目已永久删除");
});

generateAllButton.addEventListener("click", async () => {
  closeDesignMenu(true);
  const shotIds = project.shots.filter(isBatchGeneratable).map((shot) => shot.id);
  await queueGeneration(shotIds, true);
});

mediaUpload.addEventListener("change", () => uploadMedia(mediaUpload.files?.[0]));
document.querySelector("#upload-voice-reference").addEventListener("click", () => {
  voiceReferenceUpload.value = "";
  voiceReferenceUpload.click();
});
voiceReferenceUpload.addEventListener("change", () => uploadVoiceReference(voiceReferenceUpload.files?.[0]));
document.querySelector("#delete-voice-reference").addEventListener("click", deleteVoiceReference);
document.querySelector("#choose-project-design").addEventListener("click", () => {
  projectDesignUpload.value = "";
  projectDesignUpload.click();
});
projectDesignUpload.addEventListener("change", () => {
  pendingProjectDesign = projectDesignUpload.files?.[0] || null;
  document.querySelector("#project-design-file-name").textContent =
    pendingProjectDesign ? "已选择 DESIGN.md" : "未选择 DESIGN.md";
});
document.querySelector("#import-design").addEventListener("click", () => {
  closeDesignMenu(true);
  designUpload.value = "";
  designUpload.click();
});
designUpload.addEventListener("change", () => importCurrentDesign(designUpload.files?.[0]));
document.querySelector("#view-design").addEventListener("click", () => {
  closeDesignMenu(true);
  viewCurrentDesign();
});
document.querySelector("#remove-design").addEventListener("click", () => {
  closeDesignMenu(true);
  removeDesignDialog.showModal();
});
document.querySelector("#open-media-folder").addEventListener("click", openMediaFolder);
document.querySelector("#export-markdown").addEventListener("click", () => exportProject("markdown"));
document.querySelector("#export-html").addEventListener("click", () => exportProject("html"));
document.querySelector("#export-word").addEventListener("click", () => exportProject("word"));
document.querySelector("#copy-script").addEventListener("click", () => exportProject("copy"));
document.querySelector("#confirm-remove-design").addEventListener("click", removeCurrentDesign);
designMenu.addEventListener("mouseenter", openDesignMenu);
designMenu.addEventListener("mouseleave", scheduleDesignMenuClose);
designMenuTrigger.addEventListener("click", () => {
  if (designMenuPinned) return closeDesignMenu(true);
  designMenuPinned = true;
  openDesignMenu();
});
document.querySelector("#lightbox-close").addEventListener("click", closeLightbox);
document.querySelector("#lightbox-upload").addEventListener("click", () => {
  if (lightboxShotId) chooseUpload(lightboxShotId);
});
document.querySelector("#presenter-close").addEventListener("click", closePresenter);
document.querySelector("#presenter-prev").addEventListener("click", () => movePresenter(-1));
document.querySelector("#presenter-next").addEventListener("click", () => movePresenter(1));
document.querySelector("#close-cover-panel").addEventListener("click", closeCoverPanel);
document.querySelectorAll("[data-cover-close]").forEach((element) => {
  element.addEventListener("click", closeCoverPanel);
});
document.querySelectorAll("[data-cover-type]").forEach((button) => {
  button.addEventListener("click", () => {
    activeCoverType = button.dataset.coverType;
    renderCoverPanel();
  });
});
coverTitle.addEventListener("input", () => {
  ensureCovers();
  const cover = project.covers[activeCoverType];
  cover.title = coverTitle.value;
  if (!coverUsesCustomPrompt(cover)) {
    cover.prompt = coverPresetByValue(cover.preset).buildPrompt(coverPromptContext());
    coverPrompt.value = cover.prompt;
  }
  queueSave();
});
coverPreset.addEventListener("change", () => applyCoverPreset(coverPreset.value));
coverPrompt.addEventListener("input", () => {
  ensureCovers();
  const cover = project.covers[activeCoverType];
  cover.preset = "custom";
  cover.prompt = coverPrompt.value;
  coverPreset.value = "custom";
  document.querySelector("#generate-cover").textContent =
    coverGenerateLabel(cover);
  document.querySelector("#generate-cover").disabled =
    (!["pending", "processing"].includes(cover.generationStatus) && !canGenerateCover(cover));
  queueSave();
});
document.querySelector("#upload-cover").addEventListener("click", () => {
  coverUpload.value = "";
  coverUpload.click();
});
coverUpload.addEventListener("change", () => uploadCover(coverUpload.files?.[0]));
document.querySelector("#upload-cover-reference").addEventListener("click", () => {
  coverReferenceUpload.value = "";
  coverReferenceUpload.click();
});
coverReferenceUpload.addEventListener("change", () => {
  uploadCoverReference(coverReferenceUpload.files?.[0]);
});
document.querySelector("#delete-cover").addEventListener("click", deleteCover);
document.querySelector("#delete-cover-reference").addEventListener("click", deleteCoverReference);
document.querySelector("#generate-cover").addEventListener("click", () => {
  const cover = project?.covers?.[activeCoverType];
  queueCoverGeneration(cover?.generationStatus === "ready" || cover?.generationStatus === "failed");
});
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox || event.target === lightboxStage) closeLightbox();
});
document.addEventListener("keydown", (event) => {
  if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && project) {
    const row = event.target.closest?.(".shot-row");
    const typing = event.target.matches?.("textarea, input");
    // 文本框里 Alt+方向键用于移动光标，需要加 Ctrl 才当作调整顺序。
    if (row && (!typing || event.ctrlKey)) {
      event.preventDefault();
      const from = project.shots.findIndex((shot) => shot.id === row.dataset.id);
      reorderShots(from, from + (event.key === "ArrowUp" ? -1 : 1));
      return;
    }
  }
  if (event.key === "Escape" && !designMenuPopover.hidden) {
    closeDesignMenu(true);
    designMenuTrigger.focus();
  }
  if (event.key === "Escape" && !lightbox.hidden) closeLightbox();
  if (event.key === "Escape" && !presenter.hidden) closePresenter();
  if (event.key === "ArrowLeft" && !presenter.hidden) movePresenter(-1);
  if (event.key === "ArrowRight" && !presenter.hidden) movePresenter(1);
  if (event.key === "Escape" && !coverPanel.hidden) closeCoverPanel();
  if (event.key === "Tab" && !lightbox.hidden) {
    const controls = [
      document.querySelector("#lightbox-close"),
      document.querySelector("#lightbox-upload")
    ];
    const index = controls.indexOf(document.activeElement);
    event.preventDefault();
    controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
  }
});
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});
document.addEventListener("pointerdown", (event) => {
  if (!designMenuPopover.hidden && !designMenu.contains(event.target)) closeDesignMenu(true);
  if (!activeSelect) return;
  if (activeSelect.menu.contains(event.target) || activeSelect.trigger.contains(event.target)) return;
  closeSelect();
});
window.addEventListener("resize", () => {
  closeSelect();
  syncStoryboardViewport();
});
document.querySelector(".table-shell").addEventListener("scroll", () => closeSelect(), { passive: true });
window.addEventListener("popstate", async () => {
  try { await flushSave(); await route(); }
  catch (error) {
    if (project) history.pushState({}, "", `/project/${encodeURIComponent(project.id)}`);
    showToast(error.message, "error");
  }
});

// ── 风格库事件 ──
document.querySelectorAll("[data-home-tab]").forEach((button) => {
  button.addEventListener("click", () => showHomeTab(button.dataset.homeTab));
});
document.querySelector("#style-apply").addEventListener("click", openStyleApplyDialog);
document.querySelector("#style-apply-confirm").addEventListener("click", applyStyleToProject);

route();
