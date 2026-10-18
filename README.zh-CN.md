<div align="center">

# Anna

**住在你桌面上的数字生命，你的真诚伙伴。**

Anna 不只是一个 agent。她有自己的样子、性格和记忆，会陪你聊天，<br>
也会认真帮你做事：读代码、改文件、跑测试，需要时请 Claude Code 或 Codex 来帮忙。<br>
她不会假装做过没做的事；需要你拍板时，她会转过来问你。

[![CI](https://github.com/YuanyuanMa03/anna/actions/workflows/ci.yml/badge.svg)](https://github.com/YuanyuanMa03/anna/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/YuanyuanMa03/anna?color=8b7cc8)](https://github.com/YuanyuanMa03/anna/releases)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-6cb38f)](LICENSE)
[![赞助](https://img.shields.io/badge/%E2%99%A5%20%E8%B5%9E%E5%8A%A9-%E5%BE%AE%E4%BF%A1%20%C2%B7%20%E6%94%AF%E4%BB%98%E5%AE%9D-e5739a)](#赞助-anna)
![Platforms](https://img.shields.io/badge/platform-macOS%20·%20Windows%20·%20Linux-c49a5a)
[![Stars](https://img.shields.io/github/stars/YuanyuanMa03/anna?style=social)](https://github.com/YuanyuanMa03/anna/stargazers)

[English](README.md) · **简体中文** · [官网](https://anna.mayuanyuan.top) · [**♥ 赞助**](#赞助-anna)

<img src="docs/media/work.webp" alt="Anna 连接 DeepSeek 完成一个真实任务：回复、执行过的步骤和交付卡" width="880">

</div>

## 赞助 Anna

Anna 由一个人利用业余时间开发。模型调用、测试设备，还有每个版本背后的时间，都是实打实的成本。独立开发不易，如果 Anna 陪伴了你，或者帮你省了事，欢迎随手赞助，多少都是支持。谢谢你 ♥

<table>
  <tr>
    <td align="center"><img src="website/public/media/wechat.webp" alt="微信收款码" width="200"><br><sub>微信</sub></td>
    <td align="center"><img src="website/public/media/alipay.webp" alt="支付宝收款码" width="200"><br><sub>支付宝</sub></td>
  </tr>
</table>

个人和非商业使用免费。拿去卖、做成收费产品或在公司里使用，需要[商业授权](COMMERCIAL.md)。

## 认识 Anna

大多数 AI 工具，要么是一个聊天框，要么是终端里看不见的进程。Anna 两者都不是：她是住在你桌面上的角色，和你一起干活，不管换成哪个大脑，她始终是 Anna。

- ✿ **有自己的样子**：真实的 Live2D 角色。思考、读文件、等你确认、完成任务，她都有不同的神态；换个权限模式，连站姿都会变。
- ♡ **有自己的性格**：善良、理性、真诚。她有自己的观点，也尊重你的最终决定；闲聊时简短温暖，做事时先说结论。
- ❋ **记得你**：长期记忆让她记住你的习惯和偏好。记了什么，你都能看到，也随时可以删掉。
- ✓ **对你真诚**：不编造工具结果，没跑过的测试就说没跑过；超出权限的事，一定先问你。

Anna 也是一个家的名字。她是第一位住进来的伙伴，另外还有四位朋友和她住在一起：一共两女三男（Anna、Mao、名执尽、千岁、马克君），都来自 Live2D 官方免费样例。每位有自己的名字、性格和说话方式，不是 Anna 的分身；诚实、权限这些底线大家都一样。他们说话时气泡从嘴边冒出，审批卡和交付卡从手里递出来；不管是伙伴自己把活派给 Claude Code 或 Codex，还是你用 `@claude`、`@codex` 直接派活，伙伴都会接过结果，用自己的工具检查改动（有很快能跑完的测试也会跑），再告诉你能不能放心用。审阅 `@` 派的活要多花一轮模型调用，可以在“外观与能力”里关掉；大脑本身换成 Claude Code 或 Codex 时不审阅。伙伴们共用一本关于你的日记（长期记忆）和同一份工作记录，所以换伙伴、换大脑，记忆和对话都接得上；提到别的伙伴说过或做过的事，他们会如实说出处，不会揽到自己身上。

## 她能做什么

- 🧠 **真正的 agent 大脑**：基于 [pi coding agent](https://github.com/earendil-works/pi) SDK，有文件工具、终端、上下文压缩、自动重试和可续接的会话。大脑也可以换成 **Claude Code** 或 **Codex**。
- 🤝 **会派活**：像 [cc-switch](https://github.com/farion1231/cc-switch) 一样识别你电脑上已装的 coding agent。输入 `@claude 修一下那个不稳定的测试`，Claude Code 就会开工，它的授权请求出现在 *Anna 的* 确认卡上。
- 🛡️ **Claude Code 式权限模式**：规划、谨慎、协作、放手，每种模式有自己的 Live2D 站姿。规则沿用 Claude Code 的格式和匹配方式（`Bash(pnpm test *)`、`Edit(src/**)`），Anna 自己的密钥和数据永远碰不到。
- 📦 **真正的系统沙箱**：终端命令通过 Anthropic 的 [sandbox-runtime](https://github.com/anthropics/sandbox-runtime) 运行在 Seatbelt（macOS）或 bubblewrap（Linux）里。只能写工作区，每个新域名都要你同意才能联网。
- ↩️ **改动可查看、可撤销**：每个任务结束都有交付卡，可以看 diff，也可以一键撤销。
- 🔀 **服务商切换**：内置 cc-switch 的预设（Claude、Codex、Gemini 的各家端点）。可以只对某一次派活生效，也可以应用到全局；全局修改会先备份，支持一键恢复。
- 💬 **微信远程派活**：通过微信 ClawBot 在手机上给 Anna 发任务，她会排队执行，做完后发回结果。授权仍然只在桌面端进行。

<table>
  <tr>
    <td width="33%"><img src="docs/media/delegation.webp" alt="Anna 督工 Claude Code"></td>
    <td width="33%"><img src="docs/media/result.webp" alt="交付卡：diff 与撤销"></td>
    <td width="33%"><img src="docs/media/agents.webp" alt="识别到的 agent 与服务商"></td>
  </tr>
  <tr>
    <td align="center"><sub>督工 Claude Code</sub></td>
    <td align="center"><sub>交付卡：diff 与撤销</sub></td>
    <td align="center"><sub>识别到的 agent 与服务商</sub></td>
  </tr>
</table>

## 安装

下载安装包，双击安装：

| 系统 | 安装包 | 第一次打开 |
|---|---|---|
| macOS（Apple 芯片） | [Anna-mac-arm64.dmg](https://github.com/YuanyuanMa03/anna/releases/latest/download/Anna-mac-arm64.dmg) | 把 Anna 拖进“应用程序”。如果提示“无法验证”，到 系统设置 → 隐私与安全性 点“仍要打开” |
| Windows 10 / 11 | [Anna-Setup-windows-x64.exe](https://github.com/YuanyuanMa03/anna/releases/latest/download/Anna-Setup-windows-x64.exe) | 如果出现“Windows 已保护你的电脑”，点“更多信息”→“仍要运行”。不需要管理员权限 |
| Ubuntu / Debian | [Anna-linux-amd64.deb](https://github.com/YuanyuanMa03/anna/releases/latest/download/Anna-linux-amd64.deb) | 双击用“软件”安装，或 `sudo apt install ./Anna-linux-amd64.deb` |

系统会提醒一次，是因为 Anna 没有经过 Apple 公证，Windows 版也没有代码签名证书（作者没有付费账号）。

习惯命令行的话，一行命令也能装，而且不会出现上面的提醒：

```bash
# macOS / Linux
curl -fsSL https://anna.mayuanyuan.top/install.sh | bash
```

```powershell
# Windows（PowerShell）
irm https://anna.mayuanyuan.top/install.ps1 | iex
```

安装脚本会下载最新版本、校验 SHA-256，然后完成安装。用 `curl` 或 PowerShell 下载的文件不带隔离标记，所以不会弹出 Gatekeeper 或 SmartScreen 的拦截。不管用哪种方式装，之后的更新都在应用内完成（`.deb` 装在系统目录里，更新时会打开下载页，下载新的安装包覆盖安装即可）。

Anna 没有经过 Apple 公证（作者没有付费开发者账号），但每个版本都用同一个自签名身份签名，所以升级后文件夹授权会保留。钥匙串更严格：没有 Apple 团队 ID 时，保存密钥的钥匙串条目只认每个版本的代码哈希，所以每次升级后新版本第一次读取密钥时，macOS 会请你输入一次登录密码。点“始终允许”后，这个版本就不会再问。安装脚本很短，可以[先读一遍](website/public/install.sh)再运行。

第一次启动时，在“模型与设置”里配置服务商：DeepSeek 开箱即用，任何兼容 OpenAI 或 Anthropic 协议的 HTTPS 端点也可以用。密钥由系统凭据库加密保存（Keychain、DPAPI 或 libsecret）。然后选择一个文件夹，告诉 Anna 你信任它，就可以派活了。按 <kbd>Shift</kbd>+<kbd>Tab</kbd> 切换权限模式。

## 权限模式

| | 规划 | 谨慎 | 协作 | 放手 |
|---|:---:|:---:|:---:|:---:|
| 读工作区 | ✅ | ✅ | ✅ | ✅ |
| 改工作区文件 | ❌ | 问 | ✅ | ✅ |
| 测试、lint、构建 | ❌ | 问 | ✅ | ✅ |
| 其他命令、联网 | ❌ | 问 | 问 | ✅ 在沙箱内 |
| 读工作区之外（包括 `~/.ssh`） | 问 | 问 | 问 | ✅ |
| 读密钥文件（`.env`、私钥），无论用工具、命令还是搜索 | 问 | 问 | 问 | 问 |
| 高风险命令、工作区外修改 | ❌ | 逐次问 | 逐次问 | 逐次问 |
| Anna 自己的密钥和数据 | ❌ | ❌ | ❌ | ❌ |
| 舞台表现 | 安静地看笔记 | 专注 | 中性 | 前倾、节奏快 |

确认卡有四个选项：**拒绝**、**仅允许一次**、**本次会话都允许**、**总是允许**。“总是允许”会把一条 Claude Code 格式的规则写进这个工作区。微信派来的任务始终按“谨慎”执行。详见 [docs/permissions.md](docs/permissions.md)。

## 其他 agent

| agent | 派活 | 当 Anna 的大脑 | 授权方式 | 状态 |
|---|:---:|:---:|---|---|
| Claude Code | ✅ | ✅ | 逐步授权（`--permission-prompt-tool stdio`） | 已在真机验证 |
| Codex | ✅ | ✅ | 逐步授权（`app-server` JSON-RPC） | 已在真机验证 |
| Gemini CLI | ✅ | | 派活前确认一次 | 按协议实现 |
| OpenCode | ✅ | | 派活前确认一次 | 按协议实现 |
| Pi | ✅ | | 派活前确认一次 | 按文档实现 |
| Claude Desktop、Grok Build、OpenClaw、Hermes、MiniMax Code | 识别 + 切换服务商 | | | |

每次派活前，Anna 会给工作区拍一张快照，所以其他 agent 做的改动同样可以看 diff、可以撤销。协议细节和新增 agent 的方法见 [docs/kernels.md](docs/kernels.md)。

## 工作原理

- **所有大脑共用一个接口**：内核只需在每次调用工具前调用 `gate(tool, input)`，并发出统一格式的事件。权限、舞台、检查点和渠道都在 Host 里，对任何内核都一样。
- **agent 不会卡住窗口**：core 运行在独立进程里，崩溃后会自动重启，并从内核的 JSONL 日志恢复会话。
- **策略引擎是纯函数**：输入模式、规则、工作区和工具调用，输出允许、询问或拒绝。路径解析与 pi 完全一致，并会跟随符号链接。真正的安全边界是系统沙箱。

架构图和更多细节见 [docs/architecture.md](docs/architecture.md)。

## 开发

```bash
pnpm install --frozen-lockfile
pnpm assets          # 下载 Live2D 模型（不在 Git 里，见 NOTICE.md）
pnpm dev:desktop
```

```bash
pnpm lint && pnpm typecheck && pnpm test   # 单元测试、真实 pi 工具循环（faux 模型）、真实沙箱
pnpm build && pnpm test:scripted           # 桌面验收，使用脚本模型，不需要 API Key
pnpm package:mac                           # 或 package:windows / package:linux
```

CI 会在 macOS、Windows、Linux 上运行以上全部检查。想用你电脑上真实安装的 agent 测试，运行 `ANNA_REAL_AGENTS=claude,codex pnpm test tests/agents-real.test.ts`。

## 一路走来

Anna 换了三次大脑，她一直是 Anna。

1. **OpenClaw**：Anna 的第一个原型基于 [OpenClaw](https://github.com/openclaw/openclaw)。
2. **v0.2 · DeepSeek Harness**：搬进 Electron 桌面，用上真实的 Live2D 模型，由 DSH 驱动 agent 循环。
3. **v0.3 · pi**：DSH 撑不起真实的编程任务，于是大脑改用 pi coding agent SDK 重建。
4. **v0.4 · 任意大脑**：新增内核接口、Claude Code 式权限、系统沙箱，并且能把活派给你已经在用的 coding agent。

## 路线图

- [ ] 英文界面和人格
- [ ] 派活时使用独立的 Git worktree
- [ ] 在真机上验证 Gemini CLI、OpenCode、Pi 适配器
- [ ] 跨 agent 同步 MCP 和 skills；用量统计
- [ ] Claude Code / Codex 当大脑时，也能使用 Anna 自己的工具（记忆、派活）
- [ ] Windows 上的命令沙箱
- [ ] 音素级口型同步和专属 Live2D 模型

## 参与贡献

欢迎提 issue 和 PR，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 致谢

[pi](https://github.com/earendil-works/pi)（agent 大脑）、[cc-switch](https://github.com/farion1231/cc-switch)（agent 识别与服务商预设）、[sandbox-runtime](https://github.com/anthropics/sandbox-runtime)（系统沙箱）、[Project AIRI](https://github.com/moeru-ai/airi)（Live2D 渲染方案）、[openclaw-weixin](https://github.com/Tencent/openclaw-weixin)（微信协议），以及 [Claude Code](https://github.com/anthropics/claude-code)（Anna 效仿的权限模型）。

## 许可证

Anna 源码公开，按 [PolyForm Noncommercial License 1.0.0](LICENSE) 个人和非商业用途可以免费使用。拿 Anna 去卖、在它的基础上做收费产品，或在公司内部使用，需要商业授权，详见 [COMMERCIAL.md](COMMERCIAL.md)（联系 yym290552@gmail.com）。v0.4.1 及以前的版本以 MIT 发布，这些版本仍然适用 MIT。

Live2D 样例角色（春、Mark、虹色 Mao、名执尽、千岁）和 Cubism Core **不在** Anna 的许可证范围内：它们需要单独下载，并遵循 Live2D 自己的条款，详见 [NOTICE.md](NOTICE.md)。
