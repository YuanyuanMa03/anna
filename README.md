# Anna

Anna — 一个会动手做事的数字生命。v0.4 以 [pi coding agent](https://github.com/earendil-works/pi) 作为大脑，Live2D 角色是主要的交互界面，也可以通过微信 ClawBot 远程派活。

- **调用其他 agent**：像 cc-switch 一样识别这台电脑上的 Claude Code、Codex、Gemini CLI、OpenCode 等。输入 `@claude 任务` 把活派给它，它的授权请求会出现在 Anna 的确认卡上，交付后可以看 diff、撤销。也可以把 Anna 的大脑整个换成 Claude Code 或 Codex（[docs/kernels.md](docs/kernels.md)）。
- **服务商切换**：预设来自 cc-switch。派活时只给子进程注入服务商，不改任何配置文件；也可以“应用到全局”，规则和 cc-switch 一样（只改连接字段、首次写入前备份、可一键恢复）。
- **四种权限模式**：规划、谨慎、协作、放手，参考 Claude Code 的设计。每种模式有自己的 Live2D 站姿，切换时角色会点头或歪头回应（[docs/permissions.md](docs/permissions.md)）。
- **操作系统沙箱**：终端命令只能写工作区，读不到凭据目录，联网逐域名确认（macOS 用 Seatbelt，Linux 用 bubblewrap）。
- **改动可撤销**：每个任务结束后显示交付卡，可以查看 diff，也可以一键撤销文件改动。
- **核心进程隔离**：智能体运行在独立的 core 进程里，崩溃后自动重启，会话不丢。
- **跨平台**：支持 macOS、Windows、Linux，CI 在三个平台上运行。

## 安装

```bash
curl -fsSL https://anna.mayuanyuan.top/install.sh | bash        # macOS / Linux
```

```powershell
irm https://anna.mayuanyuan.top/install.ps1 | iex               # Windows
```

安装脚本会下载最新版本、校验 SHA-256 并安装。用 curl 或 PowerShell 下载的文件不会带上隔离标记，所以没有 Gatekeeper 或 SmartScreen 拦截。之后 Anna 会在应用内检查和安装更新。Anna 不申请 Apple 开发者账号，所有版本都用同一个自签名身份“Anna Local Signing”签名，因此升级后钥匙串和文件夹授权都会保留，不会反复要密码（见 `scripts/create-signing-identity.sh`）。

## 开发

```bash
pnpm install --frozen-lockfile
pnpm dev:desktop
pnpm package:mac        # 或 package:windows / package:linux
```

首次启动会打开“模型与设置”。DeepSeek 官方使用 pi 内置目录；其他兼容 OpenAI/Anthropic 协议的 HTTPS 端点选“自定义”。密钥用系统凭据库加密保存（Keychain / DPAPI / libsecret）。

在“外观与能力”里选择工作文件夹，Anna 会先问你是否信任它，然后就可以把任务交给她了。输入框里按 Shift+Tab 切换权限模式。

## 权限一览

| | 规划 | 谨慎 | 协作 | 放手 |
|---|---|---|---|---|
| 改工作区文件 | ✗ | 问 | ✓ | ✓ |
| 测试 / 构建 | ✗ | 问 | ✓ | ✓ |
| 其他命令、联网 | ✗ | 问 | 问 | 在沙箱内 ✓ |
| 高风险命令、工作区外修改 | ✗ | 逐次问 | 逐次问 | 逐次问 |
| 凭据目录、Anna 自己的数据 | ✗ | ✗ | ✗ | ✗ |

确认卡上有四个选项：拒绝、仅允许一次、本次会话都允许、总是允许。“总是允许”会写入这个工作区的规则，格式与 Claude Code 相同，例如 `Bash(pnpm install:*)`。微信派来的任务始终按“谨慎”执行。

## 微信 ClawBot

"微信"面板显示 iLink 登录二维码（微信 → 我 → 设置 → 插件 → ClawBot）。绑定后只响应扫码的账号：

- 直接发任务。Anna 忙时会立即回执"排在第 N 个"，轮到时开始，完成后把结果发回微信。
- `/status` 查看进度，`/stop` 停止，`/help` 帮助。
- 微信派的任务始终按“谨慎”模式执行；需要确认时 Anna 会主动推送，回复 `1` 允许、`0` 拒绝。高风险操作只能在桌面端批准。

协议实现参考 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)（MIT，许可证见 `assets/licenses/`）。主动推送使用用户最近一条消息的 `context_token`。iLink 在用户最后一次发言约 24 小时后会静默丢弃 bot 消息，所以超过这个时间的推送会被跳过，等你下次发消息再回复。

## 项目结构

```text
apps/desktop/main.ts         窗口、菜单、凭据库、通知；负责启动和重启 core
apps/desktop/core.ts         core 进程：Host、内核、沙箱、微信
apps/desktop/src/            Vue 舞台、导演、卡片、抽屉
packages/kernels/            AgentKernel 接口；pi 内核；外部 agent 作为大脑；内核注册表
packages/agents/             识别（cc-switch 式）、服务商预设与切换、启动参数、协议解码、进程运行
packages/permissions/        模式、规则、路径解析、命令分类、策略引擎、沙箱
packages/anna-host/          任务队列、审批、Presence、检查点、记忆、设置迁移
packages/character/          角色清单、导演（姿态、站姿、手势）、气泡 Markdown
packages/weixin/             微信 ClawBot iLink 渠道
packages/shared/             Eventa 契约、进程间 RPC、平台路径
plugins/anna-persona/        人格文本
tests/                       Vitest 单元测试；脚本模型与真实模型的桌面验收
docs/                        架构、权限、内核适配说明
```

## 数据

数据目录：macOS 为 `~/.local/share/anna-dsh/`，Linux 为 `$XDG_DATA_HOME/anna/`，Windows 为 `%APPDATA%\Anna\`。

- `settings.json`：v2 格式，包含各工作区的 `{ trusted, mode, rules }`；0.3 的设置会自动迁移。
- `credential.bin` / `weixin-credential.bin`：系统凭据库加密。
- `pi-sessions/`：内核会话，是对话记录的唯一来源。
- `checkpoints/`：撤销用的文件快照。
- `memory.json`：长期记忆，可以在界面里查看和删除。

## 检查

```bash
pnpm lint && pnpm typecheck && pnpm test     # 单元测试 + 真实 pi 工具循环（faux 模型）+ 真实沙箱
pnpm build && pnpm test:scripted             # 桌面验收，使用脚本模型，不需要密钥；CI 三平台都跑
pnpm test:desktop                            # 桌面验收，使用真实模型，会产生 API 用量
ANNA_REAL_AGENTS=claude,codex pnpm test tests/agents-real.test.ts   # 用这台电脑上真实的 Claude Code / Codex 派活和换大脑
```

## 当前边界

- 应用使用本机 ad-hoc 签名，Apple 证书签名和公证尚未完成，也没有自动更新。
- Windows 上暂时没有命令沙箱（sandbox-runtime 的 Windows 版仍是预览），放手模式下命令仍需确认。
- 撤销只覆盖 Anna 文件工具造成的改动，命令造成的改动不包含在内。
- 角色是 Live2D 免费样例模型，没有表情文件，姿态靠叠加标准参数实现。正式商用前需要核实素材许可，或使用专属模型。
- 口型在文字输出或系统朗读时摆动，不是音素级同步。微信目前只处理文字。

使用范围与第三方资产许可见 `NOTICE.md`。

## Product website

The public Anna landing page is in `website/`. See `website/README.md`.
