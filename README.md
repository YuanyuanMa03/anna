# Anna Reborn

Anna — A Composable Digital Life.

一个本地 Electron + Vue 桌面 Demo。DSH 执行真实 Agent Loop，Anna Host 管理进程、凭据、会话及产品事件。
Hiyori、Haru 和 Mark 使用真实 Live2D 模型。角色切换不切换大脑会话。

## macOS 应用

日常直接打开 `~/Applications/Anna.app`。它包含 Electron、Node、DSH、插件和三个角色，运行不需要终端、pnpm 或源码目录。

- 应用包：`dist/macos/Anna.app`
- 安装镜像：`dist/macos/Anna-0.2.0-arm64.dmg`
- 架构：Apple Silicon arm64
- 当前签名：本机 ad-hoc，严格校验通过。Apple 证书签名和公证未完成。

本机安装已替换旧版 Anna。用户数据保留在原 Anna DSH 数据目录。
打包与验收详情见 `docs/macos-package.md`。

```bash
pnpm package:mac
pnpm package:dmg
```

一键构建、覆盖安装及启动：

```bash
./script/build_and_run.sh --verify
```

`.codex/environments/environment.toml` 提供相同的 Run 入口。
`.ai-sign.json` 定义 Mac Sign 的构建目标。有效 Apple 签名身份可用后，可以用该插件完成证书签名。

## 开发启动

```bash
cd ~/git/anna-dsh
pnpm install --frozen-lockfile
pnpm dev:desktop
```

当前机器的角色资产已就绪。模型凭据已按用户授权复用，并通过 macOS safeStorage 加密保存。
首次在其他机器启动时，在“模型与设置”填写提供商、协议、HTTPS 端点、模型 ID 和 API Key。
点击“测试真实 DSH 对话”执行实际模型请求。该操作会产生供应商 API 用量。

第三方模型资产不在 Git 中。需要恢复本地资产时，运行：

```bash
python3 scripts/import-assets.py /path/to/original/Anna
```

该命令只读本地原始模型、预览和许可证，并核对 SHA-256。它不导入旧产品代码或凭据。

## 固定依赖与实际环境

| 组件 | 固定版本 |
| --- | --- |
| DSH Runtime | `0.2.1-alpha.4` |
| DSH TypeScript SDK | `0.2.1-alpha.4` |
| DSH 模型、Tool、System Prompt 包 | `0.2.1-alpha.4` |
| Cordis | `4.0.5-alpha.2` |
| Electron | `44.7.0` |
| Vue | `3.5.22` |
| Pixi | `6.5.10` |
| pixi-live2d-display | `0.4.0` |
| pnpm | `10.33.0` |

实际验证机器为 macOS arm64。开发命令使用 Node `26.7.0`。
Electron 子进程使用其内嵌 Node `24.21.0`。
DSH 原生加载器明确支持此 Electron 版本。更改 Electron 或 DSH 时必须重新执行桌面验收。
所有直接依赖使用精确版本，传递依赖由 `pnpm-lock.yaml` 固定。

## 项目结构

```text
apps/desktop/                 Electron Main、受限 Preload、Vue UI
packages/anna-host/           单写入 Host、配置、凭据边界
packages/dsh-client/          官方 SDK 生命周期、事件适配
packages/character/           三角色清单、完整模型边界适配
packages/shared/              Eventa 契约、稳定产品事件
plugins/anna-persona/          Cordis 人格插件与版本化人格文本
plugins/anna-status/           Cordis 只读状态工具
profiles/anna/                Anna Profile 基础清单
assets/characters/            本地模型与素材，不纳入 Git
assets/licenses/              上游许可与角色 ReadMe
scripts/                     构建、开发启动、本地资产恢复
tests/                       Vitest 与 Playwright Electron 验收
docs/                        架构、资源清单、验收记录
```

## 模型与凭据

当前实测提供商是智谱 `glm-5.3`，协议为 Anthropic Messages。
端点为 `https://open.bigmodel.cn/api/anthropic`。
该配置使用 DSH 官方 `dsh-llm-pi-ai` 通用模型适配器。这里的 pi-ai 是模型传输库，不执行 Agent Loop。
Anna 不启动 Pi Agent，也不直接发送模型 HTTP 请求。

DeepSeek 官方入口使用 DSH 原生 `deepseek-official` 路由。
自定义入口支持 DSH 通用适配器的 Anthropic Messages、OpenAI Chat Completions 和 OpenAI Responses 协议。
目前只对智谱路径完成真实凭据验收，其他端点需要用户提供对应凭据。
自定义模型的 131072 上下文及 8192 输出容量为 Demo 保守配置，不能据此推断供应商的真实能力上限。
本次每次模型请求的输出上限为 4096 tokens。

API Key 不进入角色卡、Profile、消息、Git 或日志。
Host 用 macOS safeStorage 加密后写入 `~/.local/share/anna-dsh/credential.bin`，权限为 0600。
DSH 仅在受控子进程环境中接收凭据。Renderer 无法读取已保存密钥。
系统凭据加密不可用时，应用拒绝明文保存。

## 插件组合

`anna-persona` 通过 `ctx.systemPrompt.section()` 注册人格。Cordis 管理其卸载副作用。
`anna-status` 通过 `ctx.tools.register(defineTool(...))` 注册 `anna_status`。
状态工具读取实际包版本、当前角色文件和本进程加载凭据，不返回密钥、用户路径或环境变量。

插件页同时显示“请求启用状态”和“实际加载状态”。
禁用或启用工具时，Host 先等待旧 SDK 的 `close()` 完成，再生成 Profile Patch 并启动新进程。
初始化后核对 Cordis 实际激活凭据和工具注册表。重组失败显示错误，不伪装成成功。
该 Demo 没有第三方插件安装或下载入口。

## 数据与恢复

默认数据目录为 `~/.local/share/anna-dsh/`：

- `settings.json`：角色、模型、插件选择与 DSH Session 引用。
- `credential.bin`：系统加密的模型密钥。
- `dsh-home/`：Anna 独立 DSH Home、Profile 与正式持久会话日志。
- `workspace/`：该 Demo 的独立工作目录。
- `transcript.json`：界面展示缓存，不是 Session 恢复机制。
- `receipts/`：当前进程的 Cordis 插件激活凭据。
- `last-error.log`：经过密钥脱敏的最近一次诊断。
- `electron/`：Electron 自身的用户数据。

跨进程恢复调用正式 `DeepSeekHarness.resumeSession(savedId)`。
恢复保留相同 DSH Home 和工作区，失败时明确报错，不静默创建替代会话。
界面只有在正式恢复接口成功后才显示“会话已恢复”。
外部进程不会恢复。中断按钮关闭整个 DSH 进程，不声称存在单轮取消接口。

## 检查

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm test:desktop
```

桌面验收使用独立 `.data/e2e-*` 目录和真实供应商请求。
它从默认 Anna 数据目录复制加密凭据，不修改当前用户会话。
通过 `ANNA_CREDENTIAL_SOURCE` 可以指定另一份 Anna DSH 配置目录。
没有凭据时，只执行类型检查、单元测试、构建和缺凭据 UI 验证。

真实截图及验收 JSON 写入 `artifacts/`。该目录不纳入 Git。
详细结果见 `docs/acceptance.md`。

## 当前边界

此项目提供可独立运行的 macOS Demo 应用和 DMG，使用本机 ad-hoc 签名。Apple 证书签名和公证尚未完成。
模型回复目前按 DSH 已提交消息展示，工具状态实时展示。
系统朗读及基于朗读状态的口型为可选功能，不代表音素级同步。
本次没有 STT、麦克风输入、长期记忆、自动任务或插件市场。

本 Demo 只向模型注册只读状态工具。shell、文件读写和工作目录变更工具均不注册。
DSH 的只读策略仍然启用，没有通过关闭审批来演示高权限操作。
进程隔离与独立目录不构成第三方代码沙箱。不要将其用于执行未知插件。

使用范围与第三方资产许可见 `NOTICE.md`。
