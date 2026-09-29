"""VoxCPM Gradio bridge. No implicit package installation or shell commands."""
import json
import sys
from pathlib import Path

if sys.version_info < (3, 10):
    raise SystemExit("VoxCPM requires Python 3.10+")
try:
    from vendor.voxcpm_tts import generate
except ImportError:
    raise SystemExit("Missing gradio_client. Install it in CODEX_STORYBOARD_PYTHON with: python -m pip install gradio_client")

import tempfile

if len(sys.argv) != 2:
    raise SystemExit("Usage: voxcpm.py <request-json-path>")
request_path = Path(sys.argv[1]).resolve()
allowed_root = Path(tempfile.gettempdir()).resolve()
if allowed_root not in (request_path, *request_path.parents) or not request_path.is_file():
    raise SystemExit(f"拒绝访问：请求文件必须位于临时目录内：{request_path}")
request = json.loads(request_path.read_text(encoding="utf-8"))
prompt_wav = Path(request["promptWav"]) if request.get("promptWav") else None
if prompt_wav and not prompt_wav.exists():
    raise SystemExit(f"参考音频文件不存在：{prompt_wav}")
generate(
    text=request["text"], output=Path(request["output"]),
    api_base="https://voxcpm.modelbest.cn", instruction=request.get("instruction", ""),
    prompt_wav=prompt_wav, prompt_text=str(request.get("promptText") or ""), cfg=2.0, steps=10,
    normalize=True, denoise=False, user_id="codex-storyboard",
)
