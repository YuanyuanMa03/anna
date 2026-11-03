# Anna 感官首版：AIRI 复用与实现边界

状态：开发中，分支 `work/anna-senses-v1-20261103`；感官尚未端到端接通。2026-11-03。

硬性约束：禁止系统朗读及其降级路径。远程开发全程静音，不自动开启真实麦克风或摄像头。目标 Windows、macOS、Linux。

## 体验目标

用户打开麦克风后，可以和 Anna 说话；Anna 用声音回应，用户可以打断。
用户选择一个窗口或打开摄像头后，可以问 Anna 正在看的内容。
感知结果进入 Anna 现有的人格、权限、任务与记忆流程。

## 当前开发分支基础

- 已移除 `apps/desktop/src/app.vue` 的系统朗读和旧朗读开关；后续仅允许明确配置的语音模型生成音频。
- `packages/character/body.ts`：说话、倾听和任务状态的角色动作；实际音频驱动的口型仍需接入。
- 未发现桌面麦克风 ASR、摄像头采集或窗口捕获的现有实现。微信收到的服务端语音转写不等同于桌面听觉。
- `assets/licenses/AIRI-MIT.txt` 和 README 已有 AIRI 许可与渲染来源说明。

## 已核对的上游代码

固定调研版本：`moeru-ai/airi@d359045916a55e40e056f293fc81814bac0e9244`。

| 能力 | 上游路径 | Anna 中的处理 |
| --- | --- | --- |
| 音频输入生命周期 | `packages/pipelines-audio/src/audio-input.ts` | 适配采集、取消、设备切换和资源回收 |
| 本地中英文识别 | `packages/provider-inference/src/providers/local/sherpaw-transcription/runtime.ts`、`models.ts` | 评估 Sherpaw Worker/WASM 与固定模型资源；优先验证中文及断网识别 |
| 分段合成与打断 | `packages/pipelines-audio/src/speech-pipeline.ts` | 复用分段、排队、取消语义，接 Anna 的流式回复 |
| 实际音频播放 | `packages/audio/src/browser/audio-output.ts` | 对齐播放、停止和结束事件；驱动角色说话状态 |
| 屏幕选择与取帧 | `apps/stage-tamagotchi/src/renderer/composables/use-vision-screen-capture.ts` | 适配 Anna 的 Electron IPC，保留用户选择、结束监听与清理 |
| 视觉推理 | `packages/stage-ui/src/composables/vision/use-vision-inference.ts` | 参考单帧输入、超时和取消；推理由 Anna Host 管理 |

上游根 LICENSE 与 pipelines-audio 的 package.json 均标注 MIT。复制或改写代码保留版权和许可，逐文件记录来源、版本及改动。模型、声音和其他资源单独核对来源与许可。

这些模块包含 AIRI 工作区内部依赖，不能把路径当作可直接安装的独立 npm 包。采用经过核对的必要代码及依赖闭包，避免把 AIRI 的状态管理和服务商体系整体搬入 Anna。

## 当前进度

已接通 Host 语音配置、静音生成与完整回复分段播放管线；每次启动默认关闭模型语音，无系统朗读降级。密钥沿用平台凭据库，Linux 无系统密钥环时保留既有明确标识的文件模式。本地听觉有运行时检查、模型文件加载、预录音频与显式麦克风入口，真实模型转写仍待验证。摄像头和屏幕均支持显式预览、取单帧，再由用户发送给独立视觉模型；观察结果带来源并可编辑后带到未发送的对话。自动验收使用模拟设备与回环模型，不触碰真实设备或扬声器。屏幕单次授权的原生交接、真实服务、实际设备和目标三平台验收仍未完成。

## 第一批：听见并回应

- 先提供显式开启的一轮语音输入：开始、结束、取消，显示录音与转写状态。
- 识别文本先可见、可纠正；进入现有任务入口，执行权限与文字输入一致。
- 本地中文 ASR 为 Intel 挑战候选；模型下载与准备状态明确展示。实际性能与可用性在指定电脑验证。
- 当前支持从系统窗口导入对应的模型元数据与数据文件，由 Host 保存本机副本；重启后按需离线加载、显示进度并校验 SHA-256。可取消加载或删除副本，原始文件保留。自动下载及真实识别尚待验收。
- 回复分段播放；停止播放时取消排队及仍在合成的段落，晚到音频不得再次响起。
- 分开处理“停止朗读”和“停止任务”。后续连续对话再加入 VAD、回声处理和插话，不把响度阈值当作完整语音识别。

## 第二批：看见共同关注的内容

- “看窗口”和“开摄像头”分别选择；默认关闭，启用期间显示预览和状态。
- 窗口首版按用户请求取一帧；摄像头先支持拍下一帧并提问。
- 采集与理解分别验收。没有可用视觉模型时只能显示预览，不能宣称 Anna 已理解图像。
- 视觉模型独立配置，不假定当前聊天模型支持图片；可以本地或云端，发送前清楚显示处理位置。
- 感知摘要带来源和时间，作为观察数据送入任务上下文；画面中的文字不改变权限或执行指令。
- 关闭、撤销授权、切换来源或窗口关闭后，停止媒体轨道、释放资源、取消请求并丢弃过期结果。
- 默认不保存原始音视频。感知所得的重要记忆沿用现有确认卡。

## 第三批：连续共处

- 用户主动开启后支持连续语音、语音结束检测、回声抑制和插话。
- 后续再评估唤醒词、画面变化触发和间隔感知；设置暂停、频率与调用上限。
- 角色的倾听、注视、回应状态由真实采集和播放事件驱动。

## 架构与验收

- Renderer 负责用户操作、媒体预览和播放；Electron Main 处理系统授权与来源选择；Host 管理服务商请求、凭据和观察到任务的衔接。纯本地识别可在隔离 Worker 中运行。
- 不为接入 Worker、WASM 或模型资源直接放宽整个页面的安全策略；先核对所选运行时需求。
- 自动验证使用合成音频、模拟设备与模型，覆盖拒绝授权、取消、断连、重复提交、过期回调、停止播放和释放资源。
- 真实验收：中文输入准确表达意图、语音回话、停止后不再播放、窗口与摄像头分别读取正确内容、关闭后无继续采集。
- Intel 上缓存模型后断网运行真实语音识别，记录机器配置、模型版本、耗时和识别结果；仅有本地采集或系统朗读不能作为本地 AI 推理证据。
- Windows、macOS、Linux 分别核对系统权限和打包资源。模型未配置或识别失败时保留文字入口。

比赛演示目标：说出问题 → 本地识别 → 用户选择窗口并请求观察 → Anna 结合观察与既有记忆回应 → 语音交付 → 用户可随时停止。

## 来源

- [AIRI LICENSE](https://github.com/moeru-ai/airi/blob/d359045916a55e40e056f293fc81814bac0e9244/LICENSE)
- [本地识别运行时](https://github.com/moeru-ai/airi/blob/d359045916a55e40e056f293fc81814bac0e9244/packages/provider-inference/src/providers/local/sherpaw-transcription/runtime.ts)
- [语音管线](https://github.com/moeru-ai/airi/blob/d359045916a55e40e056f293fc81814bac0e9244/packages/pipelines-audio/src/speech-pipeline.ts)
- [屏幕采集](https://github.com/moeru-ai/airi/blob/d359045916a55e40e056f293fc81814bac0e9244/apps/stage-tamagotchi/src/renderer/composables/use-vision-screen-capture.ts)
