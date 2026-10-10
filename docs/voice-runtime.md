# VoxCPM 配音调用与运行环境

当前配音通过 `voxcpm.mjs` 直接调用 VoxCPM 在线 Gradio 服务，不需要 Python、`gradio_client` 或 npm 第三方依赖。旧版 `voice/voxcpm.py` 和 `voice/vendor/voxcpm_tts.py` 已不再使用。

生成时会发送待朗读文字、语气指令，以及提供的参考音频和参考原文。界面生成前会要求确认；独立调用脚本时也应确认这些内容可以发送到在线服务。默认服务地址和参数以 `voxcpm.mjs` 为准。

## 给其他 AI 或项目复用

只需复制仓库根目录的 `voxcpm.mjs`。它仅导入 Node.js 内置模块，不依赖分镜台服务。使用支持内置 `fetch`、`FormData`、`Blob` 和 `AbortSignal.timeout` 的 Node.js（例如 Node.js 22）。

在同一目录创建 `generate-voice.mjs`：

```javascript
import { generateVoxcpm } from "./voxcpm.mjs";

await generateVoxcpm({
  text: "你好，这是一段语音生成测试。",
  output: "./speech.wav",
  instruction: "自然清晰的普通话，温暖平静"
});

console.log("音频已保存到 speech.wav");
```

运行以下命令会实际发送文字并生成音频：

```bash
node generate-voice.mjs
```

`output` 的父目录必须已存在；同名文件会被覆盖。函数成功时完成文件写入，没有返回音频对象。

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `text` | 待朗读文字，必填 | — |
| `output` | 音频保存路径，必填 | — |
| `instruction` | 语气或声音风格指令 | 空字符串 |
| `promptWav` | 本地参考音频路径，用于音色克隆；建议使用 WAV | 空字符串 |
| `promptText` | 参考音频的准确原文；同时提供参考音频时才启用文本引导 | 空字符串 |
| `apiBase` | 兼容相同 Gradio 接口的服务地址 | `AGENT_STORYBOARD_VOXCPM_URL` 或 `https://voxcpm.modelbest.cn` |
| `cfg` / `steps` | 生成参数 | `2.0` / `10` |
| `normalize` / `denoise` | 服务端文本规范化 / 降噪 | `true` / `false` |
| `userId` | 传给服务的用户标识 | `agent-storyboard` |
| `timeoutMs` | 上传、生成和下载共用的超时时间 | 600000（10 分钟） |

克隆音色时，在调用参数中增加 `promptWav: "/绝对路径/reference.wav"` 和 `promptText: "参考音频中实际说出的文字"`。独立客户端不会自动识别参考原文、转码、分段或拼接，只保存服务返回的音频文件。

## 分镜台内的完整配音流程

`audio.mjs` 调用上述客户端，并负责以下处理：

- 按句尾将长文尽量均分，默认以每段约 800 字为目标；这不是严格的字数上限，单个长句不会被强行截断。
- 每段重新使用同一份参考音频，失败最多尝试三次。
- 用 FFmpeg 裁掉各段首尾静音、统一响度并拼接；接缝补 0.18 秒停顿，段落接缝补 0.4 秒。
- 输出 48 kHz 单声道 PCM WAV，并用 FFprobe 读取时长。

完整配音需要 FFmpeg 和 FFprobe；Whisper.cpp 和本地模型用于参考音频原文识别及台词对齐，缺少时仍可生成配音。服务在未提供参考原文时会尝试本地识别，识别失败则退回纯音频克隆。

`audio.mjs` 还依赖 `runtime.mjs` 和 `recognition.mjs`，不能像 `voxcpm.mjs` 一样单文件复制后直接使用。其他 AI 可以参考其分段、裁剪和拼接逻辑。

## 环境配置

分镜台支持以下环境变量；服务启动时也兼容旧 `CODEX_STORYBOARD_*` 前缀，新变量优先。单独导入 `voxcpm.mjs` 时只读取新前缀的服务地址变量，或直接传 `apiBase`。

```text
AGENT_STORYBOARD_VOXCPM_URL          兼容的在线配音服务地址
AGENT_STORYBOARD_VOICE_CHUNK_CHARS   长文分段目标字数，默认 800
AGENT_STORYBOARD_FFMPEG             FFmpeg 可执行文件路径
AGENT_STORYBOARD_FFPROBE            FFprobe 可执行文件路径
AGENT_STORYBOARD_WHISPER            whisper-cli 可执行文件路径
AGENT_STORYBOARD_WHISPER_MODEL      本地 Whisper 模型文件路径
AGENT_STORYBOARD_RUNTIME            共享运行工具和模型的目录，默认仓库内 .runtime-voice
```

可执行文件优先使用显式路径，然后查找本地工具，最后尝试 PATH 中的命令；Windows 的 FFmpeg / FFprobe 还会尝试 WinGet 安装目录。本地工具目录布局：

```text
.runtime-voice/ffmpeg/bin/ffmpeg.exe
.runtime-voice/ffmpeg/bin/ffprobe.exe
.runtime-voice/whisper/whisper-cli.exe
.runtime-voice/ggml-large-v3-turbo-q5_0.bin
```

模型默认依次查找运行目录里的 `ggml-large-v3-turbo-q5_0.bin`、`ggml-large-v3-turbo.bin`，以及 `~/.cache/dsh-whisper/` 下的 `ggml-large-v3-turbo.bin`、`ggml-large-v3.bin`。依赖不会隐式安装。

## 台词对齐

Whisper 在本地识别音频并提供文本、时间戳，不会把识别音频上传到在线识别服务。CPU 识别可能较慢，对齐识别超时为 30 分钟。

分镜台把识别结果映射到有台词的镜头，允许标点差异及部分识别错误；匹配不足会报错。多字符 token 内部时间通过插值估计，因此这是识别辅助对齐，不保证音素级精度，应用前应检查边界。修改台词或镜头顺序后，旧对齐结果会被拒绝。无台词镜头保留原时长，但不会自动向配音文件插入对应静音。

## 验证

`npm test` 和 `npm run check` 用于离线测试及语法检查，不证明当前在线服务可用或音质符合要求。

需要实测时，先运行开发服务，再执行 `node scripts/voice-smoke.mjs`。脚本默认连接 `http://127.0.0.1:43218`，可用 `CODEX_STORYBOARD_URL` 指定测试服务。它会创建并保留测试项目和音频，将合成测试台词发送到 VoxCPM，然后运行本地识别、应用时长并检查旧对齐结果拒绝逻辑。请使用临时数据目录启动服务，以免把测试项目写入日常数据。

[2026-09-14 的旧版实测记录](voice-smoke-results.md) 仅供历史参考，不能作为当前 Node 客户端的在线验证结果。
