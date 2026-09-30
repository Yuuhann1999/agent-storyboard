import { defaultDataDir as resolveDefaultDataDir } from "../app/env-compat.mjs";
import { generateImageWithCodex, codexImageAvailable } from "../app/codex-image.mjs";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import readline from "node:readline";
import net from "node:net";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_NAME = "Agent Storyboard MCP";
const SERVER_VERSION = "0.8.0";
const DEFAULT_URL = "http://127.0.0.1:43218";
const ASPECT_RATIOS = ["9:16", "16:9", "3:4", "4:3", "1:1"];
const BROLL_PLAN_FILE = "broll-plan.json";
const BROLL_TYPES = ["有素材", "无素材", "纯文字"];
const BROLL_SEMANTIC_STRUCTURES = ["对比", "聚合", "筛选", "层级", "因果", "替换", "展开"];
const BROLL_REFERENCE_REPOSITORIES = [
  "https://github.com/heygen-com/hyperframes-launches",
  "https://github.com/Vincentwei1021/video-shotcraft"
];
const BROLL_TEMPLATE_REUSE_POLICY = [
  "B-roll 模板复用优先级（强制）：先从本地模板和两个指定开源仓库中寻找可直接复用的模板、组件、镜头骨架、GIF/MP4 或其他现成内容；",
  "优先选择与语义最贴合的现成方案并只做必要的文案、配色、排版和时长适配；",
  "如果现成方案不完全适配，必须从最接近的模板或骨架改造，不得直接从空白项目开始；",
  "只有在明确记录两个仓库和本地模板均无法承载核心语义、并写出检索范围、失败原因与最小替代方案后，才允许从零搭建。"
].join(" ");
const pluginRoot = fileURLToPath(new URL("..", import.meta.url));
const bundledServer = join(pluginRoot, "app", "server.mjs");
const defaultDataDir = process.env.AGENT_STORYBOARD_DATA_DIR ||
  process.env.AGENT_STORYBOARD_HOME ||
  resolveDefaultDataDir();
let storyboardProcess;

const JsonRpcError = {
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function storyboardUrl(args = {}) {
  return String(args.storyboardUrl || process.env.AGENT_STORYBOARD_URL || DEFAULT_URL).replace(/\/+$/, "");
}

async function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 50; port += 1) {
    if (await portAvailable(port)) return port;
  }
  throw new Error(`No available local port near ${startPort}`);
}

async function health(url, timeoutMs = 800) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return await response.json();
    } catch {
      // 服务还没启动。
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Storyboard service did not become healthy: ${url}`);
}

async function ensureStoryboard(args = {}) {
  const explicitUrl = args.storyboardUrl || process.env.AGENT_STORYBOARD_URL;
  if (explicitUrl) {
    const url = String(explicitUrl).replace(/\/+$/, "");
    const info = await health(url, 1500);
    return { url, alreadyRunning: true, dataDir: info.dataDir };
  }

  const requestedPort = Number(args.port || process.env.AGENT_STORYBOARD_PORT || 43218);
  const expectedUrl = `http://127.0.0.1:${requestedPort}`;
  try {
    const info = await health(expectedUrl);
    if (info.version === SERVER_VERSION) {
      return { url: expectedUrl, alreadyRunning: true, dataDir: info.dataDir };
    }
  } catch {
    // 端口上没有可用的 Agent Storyboard，继续启动内置服务。
  }

  await stat(bundledServer);
  const port = await findAvailablePort(requestedPort);
  const url = `http://127.0.0.1:${port}`;
  const dataDir = String(args.dataDir || defaultDataDir);

  storyboardProcess = spawn(process.execPath, [
    bundledServer,
    "--port",
    String(port),
    "--data-dir",
    dataDir
  ], {
    cwd: join(pluginRoot, "app"),
    detached: true,
    env: {
      ...process.env,
      AGENT_STORYBOARD_PORT: String(port),
      AGENT_STORYBOARD_DATA_DIR: dataDir,
      NODE_ENV: "production"
    },
    stdio: "ignore"
  });

  storyboardProcess.once("exit", (code) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`[agent-storyboard] app service exited with code ${code}\n`);
    }
    storyboardProcess = undefined;
  });
  storyboardProcess.once("error", () => {
    storyboardProcess = undefined;
  });
  storyboardProcess.unref();

  const info = await health(url, 15_000).catch((error) => {
    storyboardProcess?.kill();
    throw error;
  });
  return { url, alreadyRunning: false, dataDir: info.dataDir };
}

async function requestJson(path, options = {}, args = {}) {
  const base = args.storyboardUrl || process.env.AGENT_STORYBOARD_URL
    ? storyboardUrl(args)
    : (await ensureStoryboard(args)).url;
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function jsonOptions(body, method = "POST") {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}

function isMotionBrollTask(task) {
  return task?.taskType === "shot" &&
    task.rollType === "B-ROLL" &&
    ["hyperframes", "remotion"].includes(task.generator);
}

function brollPlanPath(task) {
  return join(task.outputDir, BROLL_PLAN_FILE);
}

async function findGenerationTask(taskId, args) {
  const result = await requestJson(
    "/api/generation/tasks?status=pending%2Cprocessing%2Cready%2Cfailed",
    {},
    args
  );
  const task = result.tasks.find((candidate) => candidate.taskId === taskId);
  if (!task) throw new Error(`Generation task not found: ${taskId}`);
  return task;
}

async function readBrollPlan(task) {
  try {
    return JSON.parse(await readFile(brollPlanPath(task), "utf8"));
  } catch {
    return null;
  }
}

async function requireConfirmedBrollPlan(task) {
  if (!isMotionBrollTask(task)) return null;
  const plan = await readBrollPlan(task);
  if (plan?.status !== "confirmed") {
    throw new Error(
      `B-roll 动效任务 ${task.taskId} 必须先调用 plan_broll_motion，向用户展示候选方案并获得确认后再次提交 approval=confirmed；当前不能领取或完成。`
    );
  }
  return plan;
}

function stringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
    : [];
}

function mergePlanList(next, previous) {
  return stringList(next).length > 0 ? stringList(next) : stringList(previous);
}

function withTemplateReusePolicy(value) {
  const text = String(value || "").trim();
  return text.includes("B-roll 模板复用优先级（强制）")
    ? text
    : [text, BROLL_TEMPLATE_REUSE_POLICY].filter(Boolean).join("\n\n");
}

async function planBrollMotion(args) {
  const task = await findGenerationTask(args.taskId, args);
  if (task.taskType !== "shot" || task.rollType !== "B-ROLL") {
    throw new Error("plan_broll_motion 只接受 B-ROLL 分镜任务。");
  }
  if (task.generator === "manual") {
    throw new Error("manual 分镜不进入 B-roll 动效生成流程。");
  }

  const previous = await readBrollPlan(task) || {};
  const approval = args.approval || "proposed";
  const reviewedSources = mergePlanList(args.reviewedSources, previous.reviewedSources);
  const localTemplateRoots = mergePlanList(args.localTemplateRoots, previous.localTemplateRoots);
  const plan = {
    schemaVersion: 1,
    tool: "plan_broll_motion",
    taskId: task.taskId,
    projectId: task.projectId,
    shotId: task.shotId,
    shotIndex: task.shotIndex,
    durationMs: Math.round(Number(task.duration || 0) * 1000),
    dialogue: task.dialogue || "",
    visualPrompt: task.visualPrompt || "",
    generator: task.generator,
    brollType: args.brollType || previous.brollType || "无素材",
    semanticStructure: args.semanticStructure || previous.semanticStructure || "展开",
    audienceTakeaway: args.audienceTakeaway || previous.audienceTakeaway || "",
    localTemplateRoots,
    referenceRepositories: BROLL_REFERENCE_REPOSITORIES,
    reviewedSources,
    sources: Array.isArray(args.sources) ? args.sources : (previous.sources || []),
    selectedTemplate: args.selectedTemplate || previous.selectedTemplate || "",
    motionSkeleton: args.motionSkeleton || previous.motionSkeleton || "",
    uiChanges: args.uiChanges || previous.uiChanges || "",
    researchNotes: withTemplateReusePolicy(args.researchNotes || previous.researchNotes || ""),
    researchComplete: args.researchComplete === true || previous.researchComplete === true,
    status: approval,
    updatedAt: new Date().toISOString()
  };

  if (!BROLL_TYPES.includes(plan.brollType)) {
    throw new Error(`brollType 必须是：${BROLL_TYPES.join("、")}`);
  }
  if (!BROLL_SEMANTIC_STRUCTURES.includes(plan.semanticStructure)) {
    throw new Error(`semanticStructure 必须是：${BROLL_SEMANTIC_STRUCTURES.join("、")}`);
  }
  if (!['proposed', 'confirmed'].includes(plan.status)) {
    throw new Error("approval 必须是 proposed 或 confirmed。");
  }

  if (plan.status === "confirmed") {
    const missingRepositories = BROLL_REFERENCE_REPOSITORIES.filter(
      (repository) => !plan.reviewedSources.some((source) => source.includes(repository))
    );
    if (!plan.researchComplete) {
      throw new Error("确认 B-roll 方案前必须完成本地模板和参考素材检查，并设置 researchComplete=true。");
    }
    if (missingRepositories.length > 0) {
      throw new Error(`确认 B-roll 方案前必须查看并记录两个指定开源仓库：${missingRepositories.join("、")}`);
    }
    if (!plan.selectedTemplate || !plan.motionSkeleton || !plan.uiChanges) {
      throw new Error("确认 B-roll 方案前必须填写 selectedTemplate、motionSkeleton 和 uiChanges。");
    }
  }

  await mkdir(task.outputDir, { recursive: true });
  await writeFile(brollPlanPath(task), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return {
    plan,
    readyForImplementation: plan.status === "confirmed",
    nextStep: plan.status === "confirmed"
      ? "方案已确认，现在可以领取任务并按选定骨架实现。"
      : "先把本方案展示给用户；用户确认后，用同一个 taskId 再次调用并设置 approval=confirmed。"
  };
}

function shotSchema({ requireId = false } = {}) {
  return {
    type: "object",
    properties: {
      ...(requireId ? { shotId: { type: "string" } } : {}),
      rollType: { type: "string", enum: ["A-ROLL", "B-ROLL"] },
      mediaType: { type: "string", enum: ["image", "video"] },
      duration: { type: "number", minimum: 0 },
      dialogue: { type: "string" },
      visualPrompt: { type: "string" },
      generator: {
        type: "string",
        enum: ["manual", "image-gen", "hyperframes", "remotion"]
      },
      notes: { type: "string" }
    },
    ...(requireId ? { required: ["shotId"] } : {}),
    additionalProperties: false
  };
}

function projectSummary(project) {
  return {
    id: project.id,
    title: project.title,
    aspectRatio: project.aspectRatio,
    shotCount: Array.isArray(project.shots) ? project.shots.length : Number(project.shotCount || 0),
    hasDesign: Boolean(project.hasDesign),
    duration: project.duration
  };
}

function projectUrl(baseUrl, projectId) {
  return `${String(baseUrl).replace(/\/+$/, "")}/project/${encodeURIComponent(projectId)}`;
}

function videoDependencyWarnings(shots = []) {
  const generators = new Set(shots.map((shot) => shot.generator));
  const warnings = [];
  if (generators.has("remotion")) {
    warnings.push("Remotion 生成需要当前 Agent 环境启用 Remotion 插件或本地渲染工具链。");
  }
  if (generators.has("hyperframes")) {
    warnings.push("HyperFrames 生成需要当前 Agent 环境启用 HyperFrames 插件和 CLI。");
  }
  return warnings;
}

async function uploadDesign(projectId, designPath, args) {
  const content = await readFile(designPath);
  const form = new FormData();
  form.append("file", new Blob([content], { type: "text/markdown" }), basename(designPath));
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/design`,
    { method: "POST", body: form },
    args
  );
}

function tools() {
  return [
    {
      name: "inspect_storyboard_environment",
      description: "Check the voice service, FFmpeg, Whisper alignment, and which agent CLIs (Codex, Claude Code) and image channel are available on this machine. Remotion / HyperFrames are agent-side capabilities and are not checked here.",
      inputSchema: { type: "object", properties: { storyboardUrl: { type: "string" } }, additionalProperties: false },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    {
      name: "heartbeat_storyboard_generation_task",
      description: "Renew an active generation task before its 30 minute inactivity timeout. Call periodically while working on a long render.",
      inputSchema: { type: "object", properties: { taskId: { type: "string" }, storyboardUrl: { type: "string" } }, required: ["taskId"], additionalProperties: false }
    },
    {
      name: "manage_storyboard_audio",
      description: "Generate VoxCPM voice, select a take, estimate dialogue alignment, or apply durations. Generate transmits dialogue to the online VoxCPM service: obtain user consent first. Alignment is approximate; review before applying. Poll get_storyboard_project for async status.",
      inputSchema: { type: "object", properties: { projectId: { type: "string" }, action: { type: "string", enum: ["generate", "select", "align", "apply-durations"] }, instruction: { type: "string" }, takeId: { type: "string" }, storyboardUrl: { type: "string" } }, required: ["projectId", "action"], additionalProperties: false },
      annotations: { readOnlyHint: false, openWorldHint: true }
    },
    {
      name: "open_storyboard",
      title: "Open Agent Storyboard",
      description: "Start or open the bundled local Agent Storyboard app and return its local URL.",
      inputSchema: {
        type: "object",
        properties: {
          port: { type: "number", description: "Preferred local port. Defaults to 43218." },
          dataDir: {
            type: "string",
            description: "Optional local data directory. Defaults to ~/.agent-storyboard."
          },
          storyboardUrl: {
            type: "string",
            description: "Optional existing storyboard URL to check instead of starting the bundled app."
          }
        },
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: "list_storyboard_projects",
      title: "List Storyboard Projects",
      description: "List local storyboard project summaries, optionally filtered by title.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional case-insensitive title search." },
          storyboardUrl: { type: "string", description: `Storyboard URL. Defaults to ${DEFAULT_URL}.` }
        },
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: "get_storyboard_project",
      title: "Get Storyboard Project",
      description: "Get one storyboard project with its complete shot list.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          storyboardUrl: { type: "string" }
        },
        required: ["projectId"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: "create_storyboard_project",
      title: "Create Storyboard Project",
      description: "Create a complete storyboard project in one call, including all shots and an optional local DESIGN.md.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          aspectRatio: { type: "string", enum: ASPECT_RATIOS },
          shots: { type: "array", items: shotSchema() },
          designPath: {
            type: "string",
            description: "Optional absolute path to a local Markdown visual specification."
          },
          storyboardUrl: { type: "string" }
        },
        required: ["title", "aspectRatio", "shots"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    {
      name: "update_storyboard_project",
      title: "Update Storyboard Project",
      description: "Update project metadata, append shots, patch specific shots, delete shots, or replace/remove DESIGN.md in one call.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          title: { type: "string" },
          aspectRatio: { type: "string", enum: ASPECT_RATIOS },
          appendShots: { type: "array", items: shotSchema() },
          shotUpdates: { type: "array", items: shotSchema({ requireId: true }) },
          deleteShotIds: { type: "array", items: { type: "string" } },
          designPath: {
            type: "string",
            description: "Optional absolute path to a replacement local DESIGN.md."
          },
          removeDesign: { type: "boolean" },
          storyboardUrl: { type: "string" }
        },
        required: ["projectId"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    {
      name: "delete_storyboard_project",
      title: "Delete Storyboard Project",
      description: "Permanently delete a storyboard project and all of its local media.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          storyboardUrl: { type: "string" }
        },
        required: ["projectId"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    {
      name: "list_storyboard_generation_tasks",
      title: "List Storyboard Generation Tasks",
      description: "List pending, processing, ready, or failed image/video generation tasks from the local Agent Storyboard.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Comma-separated statuses. Defaults to pending. Values: pending,processing,ready,failed."
          },
          storyboardUrl: { type: "string", description: `Storyboard URL. Defaults to ${DEFAULT_URL}.` }
        },
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: "plan_broll_motion",
      title: "Plan B-roll Motion",
      description: `${BROLL_TEMPLATE_REUSE_POLICY} 规划时仍须先检查本地模板、实际查看两个指定开源仓库并记录候选来源，向用户展示候选骨架；只有 approval=confirmed 的方案才能领取或完成 HyperFrames/Remotion B-roll 任务。`,
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          brollType: { type: "string", enum: BROLL_TYPES },
          semanticStructure: { type: "string", enum: BROLL_SEMANTIC_STRUCTURES },
          audienceTakeaway: { type: "string" },
          localTemplateRoots: { type: "array", items: { type: "string" } },
          reviewedSources: {
            type: "array",
            items: { type: "string" },
            description: "已实际查看的本地模板路径或网络仓库/帖子 URL；优先记录实际复用的模板、组件、骨架或媒体来源，确认时必须包含两个指定开源仓库。"
          },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string" },
                url: { type: "string" },
                mediaType: { type: "string" },
                localPath: { type: "string" },
                licenseNote: { type: "string" }
              },
              additionalProperties: true
            }
          },
          selectedTemplate: {
            type: "string",
            description: "必须写出优先复用的本地模板或两个指定仓库中的具体模板/组件/骨架；若只能改造，写明原方案和不适配原因，禁止只写自建。"
          },
          motionSkeleton: {
            type: "string",
            description: "先描述复用或改造的现成骨架及其元素关系，再写最小必要改动；只有记录检索失败证据后才可描述全新骨架。"
          },
          uiChanges: {
            type: "string",
            description: "只记录把现成模板适配到本镜头所需的背景、颜色、字体、文案和时长改动。"
          },
          researchNotes: {
            type: "string",
            description: "记录查过的本地模板和两个仓库、实际候选路径、复用/改造选择及证据；若没有合适候选，必须写明原因后才能从零搭建。"
          },
          researchComplete: { type: "boolean" },
          approval: { type: "string", enum: ["proposed", "confirmed"], default: "proposed" },
          storyboardUrl: { type: "string" }
        },
        required: ["taskId"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    {
      name: "claim_storyboard_generation_task",
      title: "Claim Storyboard Generation Task",
      description: "Mark a pending storyboard task as processing. HyperFrames/Remotion B-roll is blocked until plan_broll_motion has been confirmed by the user.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          storyboardUrl: { type: "string" }
        },
        required: ["taskId"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    {
      name: "generate_storyboard_image",
      title: "Generate Storyboard Image With Codex",
      description: "For an image-gen task: generate the image through the local Codex CLI's image_gen and return it to the storyboard in one call (claims a pending task, applies DESIGN.md and the reference image, keeps the task alive, completes or fails it). Use this when the current agent has no image generation of its own, such as Claude Code. Requires Codex installed and logged in; takes 1 to 6 minutes.",
      inputSchema: {
        type: "object",
        properties: { taskId: { type: "string" }, storyboardUrl: { type: "string" } },
        required: ["taskId"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    {
      name: "complete_storyboard_generation_task",
      title: "Complete Storyboard Generation Task",
      description: "Copy a generated local image or video into the storyboard media directory and mark the task ready. Confirmed B-roll motion plans are checked again before completion.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          sourcePath: { type: "string", description: "Absolute path to the generated PNG/JPEG/WebP/MP4/WebM/MOV." },
          mediaType: { type: "string", enum: ["image", "video"] },
          storyboardUrl: { type: "string" }
        },
        required: ["taskId", "sourcePath"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    {
      name: "fail_storyboard_generation_task",
      title: "Fail Storyboard Generation Task",
      description: "Mark a storyboard generation task failed and return a visible error message to the row.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          error: { type: "string" },
          storyboardUrl: { type: "string" }
        },
        required: ["taskId", "error"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    }
  ];
}

async function callTool(id, params) {
  if (["inspect_storyboard_environment", "heartbeat_storyboard_generation_task", "manage_storyboard_audio"].includes(params?.name)) {
    const input = params.arguments || {};
    let path = "/api/environment", options = {};
    if (params.name === "heartbeat_storyboard_generation_task") {
      path = `/api/generation/tasks/${encodeURIComponent(input.taskId)}/heartbeat`;
      options = jsonOptions({});
    }
    if (params.name === "manage_storyboard_audio") {
      if (!["generate", "select", "align", "apply-durations"].includes(input.action)) throw new Error("Invalid audio action");
      path = `/api/projects/${encodeURIComponent(input.projectId)}/audio/${input.action}`;
      options = jsonOptions({ instruction: input.instruction, takeId: input.takeId });
    }
    const result = await requestJson(path, options, input);
    sendResult(id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    return;
  }
  const args = params?.arguments ?? {};

  if (params?.name === "open_storyboard") {
    const result = await ensureStoryboard(args);
    sendResult(id, {
      content: [{
        type: "text",
        text: `Agent Storyboard is ready: ${result.url}\nData directory: ${result.dataDir}`
      }],
      structuredContent: result
    });
    return;
  }

  if (params?.name === "list_storyboard_projects") {
    const result = await requestJson("/api/projects", {}, args);
    const query = String(args.query || "").trim().toLocaleLowerCase();
    const projects = result.projects
      .filter((project) => !query || project.title.toLocaleLowerCase().includes(query))
      .map(projectSummary);
    sendResult(id, {
      content: [{
        type: "text",
        text: projects.length === 0
          ? "No matching storyboard projects."
          : projects.map((project) =>
            `${project.id} | ${project.title} | ${project.aspectRatio} | ${project.shotCount} shots`
          ).join("\n")
      }],
      structuredContent: { projects }
    });
    return;
  }

  if (params?.name === "get_storyboard_project") {
    const project = await requestJson(
      `/api/projects/${encodeURIComponent(args.projectId)}`,
      {},
      args
    );
    sendResult(id, {
      content: [{
        type: "text",
        text: `${project.title} | ${project.aspectRatio} | ${project.shots.length} shots`
      }],
      structuredContent: { project }
    });
    return;
  }

  if (params?.name === "create_storyboard_project") {
    let project;
    const serviceUrl = args.storyboardUrl || process.env.AGENT_STORYBOARD_URL
      ? storyboardUrl(args)
      : (await ensureStoryboard(args)).url;
    const requestArgs = { ...args, storyboardUrl: serviceUrl };
    try {
      project = await requestJson(
        "/api/projects",
        jsonOptions({ title: args.title, aspectRatio: args.aspectRatio, shots: args.shots }),
        requestArgs
      );
      if (args.designPath) project = await uploadDesign(project.id, args.designPath, requestArgs);
    } catch (error) {
      if (project?.id) {
        await requestJson(
          `/api/projects/${encodeURIComponent(project.id)}`,
          { method: "DELETE" },
          requestArgs
        ).catch(() => {});
      }
      throw error;
    }

    const summary = projectSummary(project);
    const url = projectUrl(serviceUrl, summary.id);
    const warnings = videoDependencyWarnings(project.shots);
    const warningText = warnings.length > 0 ? `\n\n注意：${warnings.join(" ")}` : "";
    sendResult(id, {
      content: [{
        type: "text",
        text: `Created ${summary.title} (${summary.aspectRatio}) with ${summary.shotCount} shots. Project ID: ${summary.id}\nOpen: ${url}${warningText}`
      }],
      structuredContent: { project: summary, projectUrl: url, warnings }
    });
    return;
  }

  if (params?.name === "update_storyboard_project") {
    if (args.designPath && args.removeDesign) {
      throw new Error("designPath and removeDesign cannot be used together");
    }
    const project = await requestJson(
      `/api/projects/${encodeURIComponent(args.projectId)}`,
      {},
      args
    );
    if (args.title !== undefined) project.title = args.title;
    if (args.aspectRatio !== undefined) project.aspectRatio = args.aspectRatio;

    const updates = new Map((args.shotUpdates || []).map((shot) => [shot.shotId, shot]));
    for (const shotId of updates.keys()) {
      if (!project.shots.some((shot) => shot.id === shotId)) {
        throw new Error(`Shot not found: ${shotId}`);
      }
    }
    project.shots = project.shots
      .filter((shot) => !(args.deleteShotIds || []).includes(shot.id))
      .map((shot) => {
        const update = updates.get(shot.id);
        if (!update) return shot;
        const { shotId, ...fields } = update;
        return { ...shot, ...fields };
      });
    project.shots.push(...(args.appendShots || []));

    let saved = await requestJson(
      `/api/projects/${encodeURIComponent(project.id)}`,
      jsonOptions({
        title: project.title,
        aspectRatio: project.aspectRatio,
        updatedAt: project.updatedAt,
        shots: project.shots
      }, "PUT"),
      args
    );
    if (args.designPath) saved = await uploadDesign(saved.id, args.designPath, args);
    if (args.removeDesign) {
      saved = await requestJson(
        `/api/projects/${encodeURIComponent(saved.id)}/design`,
        { method: "DELETE" },
        args
      );
    }

    const summary = projectSummary(saved);
    sendResult(id, {
      content: [{
        type: "text",
        text: `Updated ${summary.title} (${summary.aspectRatio}); ${summary.shotCount} shots.`
      }],
      structuredContent: { project: summary }
    });
    return;
  }

  if (params?.name === "delete_storyboard_project") {
    const project = await requestJson(
      `/api/projects/${encodeURIComponent(args.projectId)}`,
      {},
      args
    );
    await requestJson(
      `/api/projects/${encodeURIComponent(args.projectId)}`,
      { method: "DELETE" },
      args
    );
    sendResult(id, {
      content: [{ type: "text", text: `Deleted ${project.title} (${project.id}).` }],
      structuredContent: { deleted: { id: project.id, title: project.title } }
    });
    return;
  }

  if (params?.name === "list_storyboard_generation_tasks") {
    const status = encodeURIComponent(args.status || "pending");
    const result = await requestJson(`/api/generation/tasks?status=${status}`, {}, args);
    const summary = result.tasks.length === 0
      ? "No matching storyboard generation tasks."
      : result.tasks
          .map((task) => {
            const target = task.taskType === "cover"
              ? `cover ${task.coverType}`
              : `shot ${task.shotIndex}`;
            const reference = task.referenceImagePath ? ` | reference: ${task.referenceImagePath}` : "";
            return `${task.taskId} | ${task.projectTitle} (${task.aspectRatio}) | ${target} | ${task.generator} | ${task.mediaType} | ${task.status} | design: ${task.hasDesign ? task.designPath : "none"}${reference} | output: ${task.outputDir}\n${task.visualPrompt}`;
          })
          .join("\n\n");
    sendResult(id, {
      content: [{ type: "text", text: summary }],
      structuredContent: result
    });
    return;
  }

  if (params?.name === "plan_broll_motion") {
    const result = await planBrollMotion(args);
    sendResult(id, {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result
    });
    return;
  }

  if (params?.name === "claim_storyboard_generation_task") {
    const task = await findGenerationTask(args.taskId, args);
    await requireConfirmedBrollPlan(task);
    const result = await requestJson(
      `/api/generation/tasks/${encodeURIComponent(args.taskId)}/claim`,
      jsonOptions({}),
      args
    );
    sendResult(id, {
      content: [{ type: "text", text: `Claimed ${args.taskId} from ${result.task.projectTitle} (${result.task.aspectRatio}) for ${result.task.generator}.` }],
      structuredContent: result
    });
    return;
  }

  if (params?.name === "generate_storyboard_image") {
    const task = await findGenerationTask(args.taskId, args);
    if (task.generator !== "image-gen" || task.mediaType !== "image") {
      throw new Error(`任务 ${args.taskId} 不是 AI 生图任务（生成方式：${task.generator}），无法用 Codex 出图`);
    }
    const availability = await codexImageAvailable();
    if (!availability.ok) {
      throw new Error(availability.reason === "not_logged_in"
        ? "Codex 尚未登录：请先运行 codex login，或改用当前 Agent 自带的生图能力"
        : "未检测到 Codex CLI：请先安装并登录 Codex，或改用当前 Agent 自带的生图能力");
    }
    if (task.status === "pending") {
      await requestJson(`/api/generation/tasks/${encodeURIComponent(args.taskId)}/claim`, jsonOptions({}), args);
    }
    let prompt = String(task.visualPrompt || "").trim();
    if (task.hasDesign && task.designPath) {
      const design = (await readFile(task.designPath, "utf8")).slice(0, 6000);
      prompt += `\n\nProject visual system (DESIGN.md). The shot description above takes precedence when they conflict:\n${design}`;
    }
    const keepAlive = setInterval(() => {
      requestJson(`/api/generation/tasks/${encodeURIComponent(args.taskId)}/heartbeat`, jsonOptions({}), args).catch(() => {});
    }, 60_000);
    try {
      const image = await generateImageWithCodex({
        prompt,
        aspect: task.aspectRatio,
        refImages: task.referenceImagePath ? [task.referenceImagePath] : [],
        outputPath: join(task.outputDir, "image.png")
      });
      const result = await requestJson(
        `/api/generation/tasks/${encodeURIComponent(args.taskId)}/complete`,
        jsonOptions({ sourcePath: image.path, mediaType: "image" }),
        args
      );
      sendResult(id, {
        content: [{ type: "text", text: `Generated with Codex and returned to ${result.task.projectTitle}, ${result.task.taskType === "cover" ? `cover ${result.task.coverType}` : `shot ${result.task.shotIndex}`}.` }],
        structuredContent: result
      });
    } catch (error) {
      await requestJson(`/api/generation/tasks/${encodeURIComponent(args.taskId)}/fail`, jsonOptions({ error: String(error.message).slice(0, 300) }), args).catch(() => {});
      throw error;
    } finally {
      clearInterval(keepAlive);
    }
    return;
  }

  if (params?.name === "complete_storyboard_generation_task") {
    const task = await findGenerationTask(args.taskId, args);
    await requireConfirmedBrollPlan(task);
    const result = await requestJson(
      `/api/generation/tasks/${encodeURIComponent(args.taskId)}/complete`,
      jsonOptions({ sourcePath: args.sourcePath, mediaType: args.mediaType }),
      args
    );
    sendResult(id, {
      content: [{
        type: "text",
        text: `Completed ${args.taskId}; asset returned to ${result.task.projectTitle}, ${
          result.task.taskType === "cover" ? `cover ${result.task.coverType}` : `shot ${result.task.shotIndex}`
        }.`
      }],
      structuredContent: result
    });
    return;
  }

  if (params?.name === "fail_storyboard_generation_task") {
    const result = await requestJson(
      `/api/generation/tasks/${encodeURIComponent(args.taskId)}/fail`,
      jsonOptions({ error: args.error }),
      args
    );
    sendResult(id, {
      content: [{ type: "text", text: `Marked ${args.taskId} failed: ${args.error}` }],
      structuredContent: result
    });
    return;
  }

  sendError(id, JsonRpcError.INVALID_PARAMS, `Unknown tool: ${params?.name ?? ""}`);
}

async function handle(message) {
  const { id, method, params } = message;

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: params?.protocolVersion ?? "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions:
        `Use project tools to create and manage storyboard projects directly through the local API. Use generation tools to process queued assets. ${BROLL_TEMPLATE_REUSE_POLICY} For HyperFrames/Remotion B-roll, call plan_broll_motion, show the proposed motion plan to the user, and wait for approval before claiming or completing the task. Never edit project data files directly or complete a generation task before verifying its output.`
    });
    return;
  }

  if (method === "ping") return sendResult(id, {});
  if (method === "tools/list") return sendResult(id, { tools: tools() });

  if (method === "tools/call") {
    try {
      await callTool(id, params);
    } catch (error) {
      sendError(id, JsonRpcError.INVALID_PARAMS, error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (id !== undefined) sendError(id, JsonRpcError.METHOD_NOT_FOUND, `Method not found: ${method}`);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const message = JSON.parse(line);
    handle(message).catch((error) => {
      if (message.id !== undefined) sendError(message.id, JsonRpcError.INVALID_PARAMS, String(error));
    });
  } catch {
    // Ignore non-JSON stdout input.
  }
});
