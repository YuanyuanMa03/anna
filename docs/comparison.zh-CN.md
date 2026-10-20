# Anna 和她的同类

[English](comparison.md) · **简体中文**

Anna 站在三类项目的交汇处：住在屏幕上的 AI 伴侣，盯着 coding agent 的桌宠，以及替你驱动 coding agent 的桌面工具。
它们各自做了 Anna 的一部分，有几样还做得比她好。这一页如实写下她站在哪里、还差在哪里、向谁学过什么。

星数取自 2026-10-20 的 GitHub，之后会变。那天 Anna 自己是 1 颗星。

## 邻居们

### AI 伴侣：有灵魂，很少干活

| 项目 | 星数 | 是什么 |
|---|---:|---|
| [Project AIRI](https://github.com/moeru-ai/airi) | 5.05 万 | 复刻 Neuro-sama：Live2D 与 VRM、语音、陪玩游戏、全平台。做角色这件事的标杆。 |
| [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) | 1.42 万 | 免手动的语音对话，可以随时打断，带 Live2D 形象，愿意的话可以全本地运行。 |
| [Super Agent Party](https://github.com/heshengtao/super-agent-party) | 2.7 千 | 什么都做的伴侣：VRM、操控电脑、MCP 与 Skills、多人群聊、IM 机器人、直播。 |
| [my-neuro](https://github.com/morettt/my-neuro) | 1.4 千 | 可以训练声音和性格，有长期记忆、MCP、陪玩和直播。 |

在声音、直播和陪玩上，它们远远走在前面。但没有一个是你敢放进代码仓库的 coding agent：没有权限模式，没有沙箱，
没有 diff 可看，也没有东西可撤销。

### 盯着 coding agent 的桌宠

| 项目 | 星数 | 是什么 |
|---|---:|---|
| [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk) | 6.5 千 | 像素小螃蟹，实时反映 20 多种 coding agent 的状态；有授权气泡、会话总览，能在 Telegram 或飞书上远程批准。 |
| [OpenPets](https://github.com/OpenPetsHQ/openpets) | 1.3 千 | 桌宠平台，主打沙箱化的插件 SDK；对 coding agent 的反应只是可选的一层。 |

这是 Anna 最近的邻居，Clawd on Desk 和她的用户几乎完全重合。区别在于谁来干活：桌宠在旁边看着别的 agent，替它转达请求；
Anna 自己就是 agent。她把活交给 Claude Code 或 Codex 时，会把结果接回来检查一遍，再告诉你做完了没有。

### coding agent 的桌面工具

| 项目 | 星数 | 是什么 |
|---|---:|---|
| [cc-switch](https://github.com/farion1231/cc-switch) | 14.6 万 | Claude Code、Codex 等工具的服务商切换器。Anna 的服务商页就来自它。 |
| [Claude Code Router](https://github.com/musistudio/claude-code-router) | 3.78 万 | 在本机把请求路由到不同的模型和服务商。 |
| [AionUi](https://github.com/iOfficeAI/AionUi) | 3.36 万 | 一个桌面应用统管 20 多种 CLI agent。 |
| [opcode](https://github.com/winfunc/opcode) | 2.24 万 | Claude Code 的图形界面和工具箱，管理会话和自定义 agent。 |
| [CodePilot](https://github.com/op7418/CodePilot) | 6.5 千 | 多模型的 agent 客户端，支持 MCP、Skills，能用手机操控。 |
| [Crystal](https://github.com/stravu/crystal) | 3.1 千 | 并行跑多个 Claude Code、Codex 会话，每个都在自己的 git worktree 里。 |

作为工具，它们更完整；可它们也只是工具，是一块面板，不是一个人。

## Anna 强在哪里

- **换了大脑，还是同一个她。** 不管是 pi、Claude Code 还是 Codex 在思考，样子、性情和那本共用的日记都不变。换伙伴、换大脑，话都接得上。
- **自己动手，也会督工。** 派出去的活会回到她手里：她看改动、跑一遍很快的测试，再告诉你能不能放心用。
- **看得见的安全。** Claude Code 格式的四种权限模式，macOS 和 Linux 上真正的系统沙箱，每次任务前的快照，
  以及带 diff 和一键撤销的交付卡；别的 agent 做的改动也一样。
- **诚实是规矩，不是心情。** 不编造工具结果，没跑过的测试就说没跑过。日记里每一行都写着是谁记的，伙伴之间不抢彼此的话。
- **服务商和路由都在里面。** cc-switch 的预设，为只支持 Chat Completions 的服务商在本机转换格式，备用服务商的故障切换和熔断，
  还有让终端里的 agent 也走 Anna 的全局路由。

## Anna 还差在哪里

- **声音是借来的。** 她用系统自带的语音合成说话，听不见你，没有自己的声音，嘴型也只是大致张合。上面那些伴侣项目在这里领先很多。
- **认识的 agent 少。** 只有 Claude Code 和 Codex 在真机上验证过；Gemini CLI、OpenCode、Pi 是按协议做的，还没验证。Clawd on Desk 能盯二十多种。
- **Windows 上还没有命令沙箱。**
- **界面只有中文。** 英文界面和英文人格在路线图上。
- **派活不分 worktree。** 派出去的活和你共用一个工作区；Crystal 已经示范了该怎么做。
- **角色都是 Live2D 的样例。** Anna 还没有一个专门为她画的模型。
- **非商业许可证。** PolyForm Noncommercial 让个人可以免费用她，也让公司比用上面那些 MIT、Apache、AGPL 项目更难接纳她。
- **只有一个维护者。** 上面大多数项目背后都有社区。

## 她向谁学过什么

- **[OpenClaw](https://github.com/openclaw/openclaw)**：承载了 Anna 的第一个原型。
- **DeepSeek Harness**：带她搬进 Electron 桌面，用上真实的 Live2D 角色（v0.2）。
- **[pi](https://github.com/earendil-works/pi)**：她要真正完成编程任务时，用来重建大脑的底座（v0.3）。
- **[Claude Code](https://github.com/anthropics/claude-code)**：给了她权限模型，包括模式、规则格式与匹配方式、Shift+Tab，
  以及“规则记住例外，沙箱才是真正的边界”这个想法。
- **[sandbox-runtime](https://github.com/anthropics/sandbox-runtime)**：就是那个沙箱。
- **[cc-switch](https://github.com/farion1231/cc-switch)**：教会她找到你电脑上已经装好的 agent，也借给她服务商预设和导入链接的格式。
- **[Project AIRI](https://github.com/moeru-ai/airi)**：示范了在她所用的 Web 技术栈上怎样渲染 Live2D，也是她衡量“一个角色做得好不好”的标尺。
- **[openclaw-weixin](https://github.com/Tencent/openclaw-weixin)**：为她打开了微信的门。
- **Live2D 官方免费样例**：伙伴们的样子，遵循 Live2D 自己的条款（见 [NOTICE.md](../NOTICE.md)）。

接下来值得借鉴的：Clawd on Desk 的手机端批准和所有会话的总览，以及 Crystal 的每个任务一个 worktree。
