# Mac mini 本地语音

本机部署日期：2026-11-04。TTS 和 ASR 都在电脑上运行，不需要 API Key，也不会按次产生 API 费用。安装模型时需要联网，准备好后推理不需要外网。

## 使用

1. 打开 `~/Applications/Anna.app`。如果 macOS 询问 Anna 访问钥匙串，请在系统窗口允许；密码只在系统窗口输入。
2. 打开“感官”，点击“加载已保存的本地模型”。就绪后可选择预录音频，或明确点击“开启麦克风录音”。结束后先检查转写，再带入对话。
3. 本地语音配置已保存。点击“生成语音文件”只生成文件，不播放。主页的“模型语音”每次启动均关闭，只有明确开启后才会播放回复。

当前是一轮录音、识别、确认和回复流程，尚无连续监听或唤醒词。关闭感官面板会释放识别模型和设备。语音服务本身只接受本机请求，不采集设备，也不播放音频。

## 已部署的组件

| 项目 | 本机配置 |
| --- | --- |
| TTS | Kokoro v1.1-zh，INT8 神经模型，sherpa-onnx 2.0.1，CPU 4 线程 |
| 音色 | `anna` 是 `zf_001`（speaker 3）的本地别名；也接受模型内数字 speaker ID 0–102 |
| 语音地址 | `http://127.0.0.1:17861/v1`，模型 ID `kokoro-local`，不填密钥 |
| ASR | 本地中英文 Paraformer INT8，Anna 内的独立 Worker/WASM；模型约 226 MiB |
| 持久化目录 | `~/Library/Application Support/Anna/local-speech`；ASR 在同级 `hearing-model` |
| 凭据 | 本地语音配置由 macOS 凭据存储加密保存；没有云端密钥 |
| 登录启动 | `~/Library/LaunchAgents/com.yuanyuanma.anna.local-tts.plist`，只监听 `127.0.0.1` |

没有使用系统朗读。运行时使用神经模型直接生成 PCM/WAV；部署包排除了不使用的 espeak 目录。无需安装 Docker、PyTorch 或独立 GPU。Python 环境单独保存，不修改系统 Python 包。

停止服务：

```sh
launchctl bootout "gui/$(id -u)/com.yuanyuanma.anna.local-tts"
```

再次启动：

```sh
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.yuanyuanma.anna.local-tts.plist"
curl --fail http://127.0.0.1:17861/health
```

日志是上述 `local-speech` 目录中的 `service.log` 和 `service-error.log`，不记录用户文本。服务串行生成，忙时返回 429，不积压长队列。取消会停止 Anna 接收和播放该结果，当前模型调用仍可能在服务端完成；停止本地服务可释放模型内存。

## 复现与证据

- 上游模型：[Kokoro v1.1-zh 说明](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html)、[音色编号](https://k2-fsa.github.io/sherpa/onnx/tts/all/Chinese-English/kokoro-multi-lang-v1_1.html)。模型包保留 Apache-2.0 LICENSE；模型权重和 Python 环境不提交到 Git。
- 下载包 `kokoro-int8-multi-lang-v1_1.tar.bz2` 为 147,052,523 字节，SHA-256 `259c9c8bc906d6078e4e0570421885dabb68b539c2f970fcbb890a58eeaf3e9c`；与上游 release digest 一致。
- `model.int8.onnx` SHA-256 `05d793700b0b507f760c183c0e39bdd6a97b43d32fdc7bf7b54a5179f1b11222`；`voices.bin` 为 `e64a5a581d8c2a350d848f51c3121657cd83aa07ed6109172177345874a7244c`。
- 本机 CPU 生成“你好，我是安娜。我们可以一起工作，也可以聊聊天。”约 2.69 秒，音频长 4.84 秒，24 kHz 单声道。测试未播放，不能据此声称音质已经试听认可。
- 安装包隔离验收经过界面 → Main → Host → 本机 TTS，再将真实 WAV 交给 Anna Worker ASR，文件及虚拟麦克风均转写为“你好我是安娜我们可以一起工作也可以聊聊天”。模型加载约 8.33 秒，文件识别 1.83 秒，虚拟麦克风识别 1.34 秒。设备访问和播放次数均为零。报告保存于本机 `.data/local-speech/anna-roundtrip.json`。
- 使用隔离测试凭据的安装包验收不代表正式安装版钥匙串授权通过。首次正式启动曾停在 macOS 钥匙串授权；用户在系统窗口允许后，已在 `~/Applications/Anna.app` 的真实用户配置中验证：本地语音配置读出正确、生成 227 KB WAV、加载已保存的 226 MB ASR 模型，并通过真实系统文件选择窗口选取合成录音，得到“你好我是安娜我们可以一起工作也可以聊聊天”。本次没有使用测试凭据或模拟文件窗口，未修改钥匙串 ACL、未降级为明文；未播放音频或开启真实麦克风、摄像头。

服务协议检查（合成波形，不加载模型、不播放）：

```sh
"$HOME/Library/Application Support/Anna/local-speech/venv/bin/python" scripts/local-speech/test_server.py
```

完整静音回环测试沿用 `tests/accept-local-hearing.mjs`，明确设置 `ANNA_LOCAL_TTS_URL=http://127.0.0.1:17861/v1` 和预期短语 `你好|一起工作|聊聊天`；其余模型与音频参数见审阅记录。没有设置该变量时，原三平台公开录音检查不调用 TTS。

本次没有删除既有会话、工作目录、模型配置或密钥。安装前未发现用户 Applications 下的 Anna，本次为新增安装；本地语音和 ASR 记录原先不存在。本机服务和配置均可单独停用，不影响原有聊天模型。
