# Voice smoke test - 2026-09-14

> 历史记录：以下结果来自旧版 Python / gradio_client 实现，保留当时的测试环境与结论。当前客户端已改为纯 Node.js；调用方法和当前依赖见 [配音运行说明](voice-runtime.md)。这些结果不代表当前版本已通过在线实测。

Environment: Windows, Python 3.12.10 (isolated voice venv), gradio_client 2.7.0,
Whisper.cpp 1.9.2 CPU, multilingual large-v3-turbo Q5_0 local model.

The vendored DSH VoxCPM runner successfully generated online audio twice. The first
direct-run sample was 6.88 seconds; the full API test sample was 6.72 seconds.

Test project: `project-mu0w8d82-l509dt` (retained in local development data).

- Online synthesis: passed; output downloadable through the media API.
- Local Whisper recognition: passed; both sentences recognized.
- Dialogue timing: 0-3.13s and 3.13-6.72s for the API sample.
- Duration application: 3.13s / 3.59s; the silent shot stayed at 2s.
- Stale dialogue protection: passed; old timing rejected after editing dialogue.
- Full-file FFmpeg decode: passed with no errors.
- Backend remained healthy; no server errors logged.
- UI: voice controls and recognized timeline visible under the script editor,
  absent from the storyboard panel.
- Browser playback: NOT passed. Clicking the native audio play control caused the
  Codex in-app browser test tab to crash. Recovery through the automation surface
  was blocked on the crash page. Cause is not established; do not interpret file
  decoding success as proof of browser playback success.

`npm test`: 10 passing tests. `npm run check`: passed.

Re-run the explicit online test with `node scripts/voice-smoke.mjs`. It creates
another test project and sends only its synthetic dialogue to VoxCPM.
