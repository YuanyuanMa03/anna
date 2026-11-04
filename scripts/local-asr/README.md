# 可选的本地 ASR 节点

这是当前 Mac 上实际提供 Paraformer API 的适配代码，纳入原仓库供 Git 部署。网关不导入它；明确运行下列命令才会加载 CPU 模型。依赖与 TTS 共用 Sherpa ONNX/NumPy，不包含 MLX、Torch 或语言模型运行时。

使用单独的 Python 3.11 环境，安装 `requirements.txt`。系统需已有 ffmpeg，放在 PATH 或用 ANNA_FFMPEG 指定其绝对路径。模型目录包含 encoder.int8.onnx、decoder.int8.onnx、tokens.txt。权重不入库；已有 `scripts/prepare-hearing-fixture.mjs` 固定下载来源、版本、大小与 SHA-256，准备后的原始目录为 `.data/hearing-fixture/raw/sherpa-onnx-streaming-paraformer-bilingual-zh-en`。准备会下载约 1 GB 公共模型，不由网关启动命令自动执行。

在本机明确准备好后，macOS/Linux：

```sh
export ANNA_ASR_MODEL_DIR="/绝对路径/模型目录"
python -m uvicorn server:app --app-dir scripts/local-asr --host 127.0.0.1 --port 17863 --no-access-log
```

PowerShell：

```powershell
$env:ANNA_ASR_MODEL_DIR="C:\Models\paraformer"
python -m uvicorn server:app --app-dir scripts/local-asr --host 127.0.0.1 --port 17863 --no-access-log
```

命令都从仓库根目录执行；仅绑定本机，通过 New API 的设备鉴权入口对外提供服务，不直接公开此无鉴权节点。没有模型时不启动，健康检查 `/health` 不进行推理。支持 `/v1/models` 和 `/v1/audio/transcriptions`，模型 ID 为 paraformer-zh-en；请求用 multipart、已知 Content-Length，最多 20 MiB 音频、120 秒，单并发；不采集麦克风、不播放音频，不声称 HTTP 取消一定中断已开始的模型计算。

TTS 源码已在 `scripts/local-speech/server.py`，使用及模型准备见 `docs/local-speech-mac.md`。本次只迁入 ASR 源码、校验 Python 语法，没有重启现有节点或安装第二套模型。Mac 实际流程证据见 `docs/reviews/gateway-workbench-v1.md`；Windows/Linux 的 Python wheel、ffmpeg、模型目录与性能仍待目标机原生验收，不能把可移植命令当作已验收。
