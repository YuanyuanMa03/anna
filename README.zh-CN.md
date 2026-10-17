<div align="center">

# Anna

**一个有脸的桌面 coding agent。**

Anna 是住在你桌面上的 Live2D 角色，会真的动手干活：读代码、改文件、跑测试。<br>
遇到更适合 Claude Code 或 Codex 的任务，她会派给它们。每一步都演在舞台上。

[![CI](https://github.com/YuanyuanMa03/anna/actions/workflows/ci.yml/badge.svg)](https://github.com/YuanyuanMa03/anna/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/YuanyuanMa03/anna?include_prereleases&color=8b7cc8)](https://github.com/YuanyuanMa03/anna/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-6cb38f)](LICENSE)
![Platforms](https://img.shields.io/badge/platform-macOS%20·%20Windows%20·%20Linux-c49a5a)
[![Stars](https://img.shields.io/github/stars/YuanyuanMa03/anna?style=social)](https://github.com/YuanyuanMa03/anna/stargazers)

[English](README.md) · **简体中文** · [官网](https://anna.mayuanyuan.top)

<img src="docs/media/approval.webp" alt="谨慎模式下，Anna 改文件前先请你确认" width="880">

</div>

## 为什么做 Anna

coding agent 很强，但看不见：终端一直滚，一不留神就跟丢了。Anna 把 agent 的工作过程搬上舞台。瞄一眼就知道她在读、在想、在等你，还是已经做完。需要你拍板时，确认卡就出现在她身边。以干活为主，陪伴是外壳。

- 🧠 **真正的 agent 大脑**：基于 [pi coding agent](https://github.com/earendil-works/pi) SDK，有文件工具、终端、上下文压缩、自动重试和可续接的会话。大脑也可以换成 **Claude Code** 或 **Codex**。
- 🤝 **会派活**：像 [cc-switch](https://github.com/farion1231/cc-switch) 一样识别你电脑上已装的 coding agent。输入 `@claude 修一下那个不稳定的测试`，Claude Code 就会开工，它的授权请求出现在 *Anna 的* 确认卡上。
- 🛡️ **Claude Code 式权限模式**：规划、谨慎、协作、放手，每种模式有自己的 Live2D 站姿。规则沿用 Claude Code 格式（`Bash(pnpm test:*)`、`Edit(src/**)`），凭据目录永远碰不到。
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

```bash
# macOS / Linux
curl -fsSL https://anna.mayuanyuan.top/install.sh | bash
```

```powershell
# Windows（PowerShell）
irm https://anna.mayuanyuan.top/install.ps1 | iex
```

安装脚本会下载最新版本、校验 SHA-256，然后完成安装。用 `curl` 或 PowerShell 下载的文件不带隔离标记，所以不会弹出 Gatekeeper 或 SmartScreen 的拦截。之后的更新在应用内完成。

Anna 没有经过 Apple 公证（作者没有付费开发者账号），但每个版本都用同一个自签名身份签名，所以升级后钥匙串和文件夹授权都会保留。安装脚本很短，可以[先读一遍](website/public/install.sh)再运行。

第一次启动时，在“模型与设置”里配置服务商：DeepSeek 开箱即用，任何兼容 OpenAI 或 Anthropic 协议的 HTTPS 端点也可以用。密钥由系统凭据库加密保存（Keychain、DPAPI 或 libsecret）。然后选择一个文件夹，告诉 Anna 你信任它，就可以派活了。按 <kbd>Shift</kbd>+<kbd>Tab</kbd> 切换权限模式。

## 权限模式

| | 规划 | 谨慎 | 协作 | 放手 |
|---|:---:|:---:|:---:|:---:|
| 读工作区 | ✅ | ✅ | ✅ | ✅ |
| 改工作区文件 | ❌ | 问 | ✅ | ✅ |
| 测试、lint、构建 | ❌ | 问 | ✅ | ✅ |
| 其他命令、联网 | ❌ | 问 | 问 | ✅ 在沙箱内 |
| 高风险命令、工作区外修改 | ❌ | 逐次问 | 逐次问 | 逐次问 |
| `~/.ssh`、`~/.aws`、钥匙串、Anna 自己的数据 | ❌ | ❌ | ❌ | ❌ |
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

Anna 换了三次大脑，才真正能干活。

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

代码采用 [MIT](LICENSE) 许可证。Live2D 样例角色（Hiyori、Haru、Mark）和 Cubism Core **不在** MIT 范围内：它们需要单独下载，并遵循 Live2D 自己的条款，详见 [NOTICE.md](NOTICE.md)。
