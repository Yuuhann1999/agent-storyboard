---
name: process-storyboard-tasks
description: Process pending Agent Storyboard image and video generation tasks. Use when the user asks to generate storyboard assets, process the storyboard queue, generate all shots, generate a specific storyboard row, or return Image Generation, HyperFrames, or Remotion outputs to the local storyboard.
---

# Process Agent Storyboard Tasks

## Task recovery

While processing a long render, call `heartbeat_storyboard_generation_task`
at least every 10 minutes. Tasks expire after 30 minutes without a heartbeat.
If the user released a task or its ID changed, stop attempting to complete it;
never attach a late output to a replacement task automatically.

Process the local storyboard queue. The MCP tools start the bundled local app automatically when needed and default to `http://127.0.0.1:43218`.

If the current agent session does not expose Storyboard MCP tools such as `list_storyboard_generation_tasks`, `claim_storyboard_generation_task`, or `complete_storyboard_generation_task`: in Codex, use `tool_search` to search for `agent storyboard` and load the deferred tools; in Claude Code, check that the `agent-storyboard` MCP server is connected (`/mcp`). Only if the tools still cannot be found, tell the user to start a new conversation or restart the agent so plugin tools are reloaded.

## Mandatory B-roll motion gate

For every `B-ROLL` shot routed to `hyperframes` or `remotion`, `plan_broll_motion` is mandatory. Do not claim the task, write a composition, download media, render, or complete the task before this gate is confirmed. The MCP server rejects both claim and completion when the confirmed plan is missing.

### Reuse-first template policy (mandatory)

Treat the local template roots and the two required repositories as the primary production library. Before designing a new composition, identify a concrete reusable template, component, shot skeleton, GIF/MP4, or other directly usable media candidate from the inspected sources. If a source has no suitable candidate, record that explicit empty result and the reason. Select the closest existing candidate, reuse it directly whenever it fits, and make only the minimum changes needed for the shot's dialogue, visual hierarchy, palette, typography, and duration.

Do not start from a blank composition when an existing candidate can carry the shot's core semantic structure. If no candidate fits, adapt the closest existing skeleton and record the original path plus the mismatch and adaptation boundary. A from-scratch motion system is an exception: use it only after the plan records the local roots and both repositories searched, the concrete mismatch, why adaptation would fail, and the smallest new structure required. The confirmed plan must carry this evidence in `selectedTemplate`, `motionSkeleton`, `sources`, and `researchNotes`.

Before asking for confirmation, research the shot in this order:

1. Read every available local B-roll template under the project's template roots or the active workspace template directory. Record the roots checked, including an explicit empty result.
2. Inspect both required reference repositories, even when a local candidate exists: `https://github.com/heygen-com/hyperframes-launches` and `https://github.com/Vincentwei1021/video-shotcraft`. For each repository, record a concrete candidate path or an explicit "no suitable candidate" result with the reason.
3. Choose the best reusable candidate across the local roots and repositories. Prefer direct reuse; if it needs changes, keep the adaptation minimal and preserve the source skeleton's relationships and phase order.
4. When an external reference is useful, inspect public X posts and their attached media. Prefer a directly usable public GIF/MP4/video over a screenshot; use a screenshot only when the media cannot be accessed. Record the source URL and a rights/source note, and never invent an account, post, quote, or asset URL.

Call `plan_broll_motion` with `approval: "proposed"` and include the shot's duration, dialogue, audience takeaway, `brollType` (`有素材` / `无素材` / `纯文字`), and `semanticStructure` (`对比` / `聚合` / `筛选` / `层级` / `因果` / `替换` / `展开`). Name the selected reusable local or repository template/component/media path first; if adapting, name the source skeleton and the exact mismatch; include any direct media sources and only the minimum UI changes: background, anchor color, font, and personalization. Show that proposal to the user and wait for confirmation.

After the user confirms, call the same tool again with `approval: "confirmed"`, `researchComplete: true`, both required repository URLs in `reviewedSources`, and complete `selectedTemplate`, `motionSkeleton`, and `uiChanges`. Only then continue to claim and implement the task. If no suitable local or external motion exists, report the gap and ask for a decision rather than silently inventing a new motion system.

## Workflow

1. Call `list_storyboard_generation_tasks` with status `pending`.
2. Inspect the generators used by the pending tasks and verify the matching local capabilities before claiming anything:

   - `image-gen` requires an image generation capability. If your agent has its own (Codex: the built-in `imagegen` skill and tool), use it. If it does not (for example Claude Code), use the `generate_storyboard_image` tool, which generates through the local Codex CLI; check `inspect_storyboard_environment` first and confirm the "AI 生图" item is ready.
   - `hyperframes` requires the HyperFrames and HyperFrames CLI skills.
   - `remotion` requires the Remotion skill and its local rendering toolchain.

   If a required capability is unavailable, do not claim affected tasks. Report the exact missing capability and continue with tasks whose generators are available.

3. Probe the local environment with read-only checks before deciding to install anything:

   - Check Node.js, npm, and pnpm availability and versions.
   - Check whether the task `outputDir`, active workspace, or chosen render directory already has `package.json`, a lockfile, and `node_modules`.
   - Check for local CLIs with existing project commands such as `pnpm exec ...`, `npm run ...`, or executable files under `node_modules/.bin`.
   - Check for global CLIs only with non-installing commands such as `command -v`, `where`, or direct `--version` after the command is found.
   - Check whether Chromium, FFmpeg, or tool-specific render caches already exist when the selected renderer needs them.

   Do not use commands that can implicitly download packages as probes. Do not run `npx remotion`, `pnpm dlx`, or package-manager `exec` forms that will install missing packages merely to test availability.

4. Prefer existing render environments. Use local project dependencies first, then compatible global CLIs. Install only when a required tool is missing, incompatible, or no local dependency set exists. Any install must be explicit and must go into the task `outputDir` or a dedicated renderer cache, not into the user's unrelated project.
5. Process available tasks one at a time.
6. For eligible B-roll tasks, complete the mandatory motion gate above. For all other tasks, continue directly to claiming after capability checks.
7. Before generating, call `claim_storyboard_generation_task`.
8. If the claimed task has `hasDesign: true`, read the complete Markdown file at the exact absolute `designPath` before generating anything. Apply it as the project-wide visual system:

   - `visualPrompt` defines the concrete shot subject and requested content.
   - `DESIGN.md` defines shared visual style, color, typography, composition, texture, and motion language.
   - An explicit shot requirement takes precedence if it conflicts with the general visual system.

9. Route by `generator`:

   - `image-gen`: with your own image generation, use the built-in `imagegen` skill and tool. Without one, call `generate_storyboard_image` with the `taskId` instead: it claims a pending task, applies `DESIGN.md` and the reference image, keeps the task alive, verifies the file, and completes or fails the task by itself (skip steps 7, 10 and 11 for that task; expect 1 to 6 minutes per image and process tasks one at a time). Treat `visualPrompt` as the primary prompt and honor the task's `aspectRatio`. If the task includes `referenceImagePath`, use that local image as the visual reference/input for the generation or edit. Copy the final verified image into the active workspace before completing the task.
   - `hyperframes`: use the HyperFrames and HyperFrames CLI skills. Start from the selected local or repository template/component/media skeleton, reuse it directly or make the smallest documented adaptation, then create the composition with the task's `width`, `height`, duration, and `visualPrompt`. Lint, inspect, render to MP4, and verify the output.
   - `remotion`: use the Remotion skill. Start from the selected local or repository template/component/media skeleton, reuse it directly or make the smallest documented adaptation, then render an MP4 with the task's `width` and `height` matching the task duration, and verify the output.

10. Technically verify each generated video before completion: the file exists, is readable, has the requested `width` and `height`, has a duration close to the task duration, and has a valid video stream/codec. Then visually inspect representative frames to ensure the render is not blank, black, or the wrong composition.
11. Call `complete_storyboard_generation_task` with the exact absolute output path and correct media type.
12. If generation or verification fails, call `fail_storyboard_generation_task` with the concise cause.
13. Continue until no processable pending tasks remain.

## Output locations

Use the exact absolute `outputDir` supplied by the task. Keep all generated source code, intermediate files, and final outputs for that task inside this directory. The MCP completion tool copies the final image or video into the storyboard media directory.

## Guardrails

- Do not mark a task complete until the exact local file has been visually or technically verified.
- Do not silently switch a requested HyperFrames task to Remotion, or vice versa.
- Do not use external API keys for Image Generation when the built-in image tool is available.
- Do not process `manual` generator rows.
- Do not create a blank composition or invent a new motion system before checking the local templates and both required repositories. If no existing material fits, keep the plan's explicit mismatch evidence with the task output.
- Preserve the requested duration for video tasks.
- Preserve `projectId`, `aspectRatio`, `width`, and `height`; never return an asset to a different project.
- Never guess, truncate, or partially read `DESIGN.md` when `hasDesign` is true.
- Do not apply a DESIGN.md from the active workspace or another project; only use the task's exact `designPath`.
- Do not write video project files outside the task's exact `outputDir`.
