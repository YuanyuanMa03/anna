# Anna v0.4 架构

```
┌──────────── Electron main ─────────────┐        ┌──────────────── Anna core（utilityProcess）────────────────┐
│ 窗口、菜单、对话框、系统通知            │  RPC   │ Host：串行任务队列 · 权限闸门 · 审批 · 检查点 · 记忆      │
│ 系统凭据库（safeStorage）只在这里解密   │◄──────►│   │            │                                          │
│ 核心崩溃 → 自动重启（每分钟最多 3 次）  │        │   ▼            ▼                                          │
└───────────────▲────────────────────────┘        │ AgentKernel   Presence（内核事件 → 舞台状态/交付统计）     │
                │ Eventa IPC（受限 preload）       │ （pi 今天；    Channels（微信 ClawBot）                     │
┌───────────────┴────────────────────────┐        │  Claude Code/  CommandSandbox（Seatbelt / bubblewrap）      │
│ Renderer：Live2D 舞台 + 导演 + 卡片     │        │  Codex 规划中）                                            │
└────────────────────────────────────────┘        └────────────────────────────────────────────────────────────┘
```

## 进程

- **main**（`apps/desktop/main.ts`）负责窗口、菜单、文件夹选择、系统通知，以及系统凭据库。它只做加解密，不跑智能体。
- **core**（`apps/desktop/core.ts`）是 Electron `utilityProcess`。Host、内核、沙箱代理和微信渠道都跑在这里。长任务、上下文压缩和大段搜索不会卡住窗口；core 崩溃后由 main 重启，会话从内核的 JSONL 文件恢复。
- 两边通过 `packages/shared/rpc.ts` 通信。core 退出后，旧连接上的新请求会立即失败，不会无限等待。
- core 读取密钥要向 main 申请，只能申请 `credential.bin` 和 `weixin-credential.bin` 这两个名字。

## 内核接缝（`packages/kernels/`）

`AgentKernel` 是 Anna 和智能体内核之间的唯一接口。内核只需要做两件事：

1. 每次调用工具前调用 `gate(tool, input)`。
2. 发出归一化事件：`thinking`、`text`、`tool-start`、`tool-end`、`compacting`、`retrying`。

权限、舞台表现、交付统计、检查点和渠道都在 Host 里，与具体内核无关。接入 Claude Code 或 Codex 的方法见 [kernels.md](kernels.md)。

pi 适配器（`kernels/pi/kernel.ts`）的要点：

- 使用 pi 的 `createAgentSession`，保留 pi 原版编码提示词，Anna 的人格、工作区、权限和记忆说明追加在后面。
- 自动压缩上下文、自动重试；JSONL 会话放在 `pi-sessions/`。
- 不加载工作区里的扩展代码（`noExtensions`）。未信任的文件夹也不加载 `AGENTS.md`、skills 和 prompt templates。
- 有沙箱时，用沙箱包装后的 `bash` 替换 pi 自带的；其余工具仍用 pi 原生实现。
- 对话记录只从会话分支推导：来源（桌面/微信）和中断记录写成 custom entry，不进入模型上下文；切换权限模式时写一条 custom message 告诉模型。

## 外部 agent（`packages/agents/`）

识别方式参照 cc-switch：除了 PATH，还会搜索版本管理器和包管理器的全局目录，因为图形界面应用继承不到终端的 PATH。派活和换大脑共用同一套适配器：`launch` 生成命令行参数，`adapters` 解码输出流，`runner` 管理进程和授权回传。外部 agent 的授权请求经过的是 Anna 自己的 `gate`，所以模式、规则、确认卡和检查点对它们同样有效。派活前会给工作区拍快照，用于 diff 和撤销。详见 [kernels.md](kernels.md)。

## 权限（`packages/permissions/`）

细节见 [permissions.md](permissions.md)。`engine.decide()` 是纯函数：输入模式、规则、工作区、是否有沙箱和工具调用，输出 allow / ask / deny。路径解析与 pi 完全一致，并跟随符号链接。真正的安全边界是操作系统沙箱，命令分类只用来减少确认次数。

## 舞台

- **Presence**（`anna-host/presence.ts`）把内核事件翻译成 `AnnaState`。并行的多个确认会叠加计数，全部处理完才恢复原来的姿态。
- **Director**（`character/director.ts`）在姿态之上还有三层：
  - 优先级和最短停留时间；
  - 权限模式的站姿：规划时安静地低头看笔记，谨慎时专注、眉毛微抬，协作时中性，放手时身体前倾、节奏更快；
  - 切换模式时的一次性手势：放宽权限点头微笑，收紧权限歪头抬眉。
- 舞台光晕和模式徽章的颜色随模式变化：规划蓝、谨慎琥珀、协作淡紫、放手绿。

## 数据

| 文件 | 内容 |
|---|---|
| `settings.json` | v2：角色、模型、内核、各工作区的 `{ trusted, mode, rules }`。从 v1 自动迁移 |
| `credential.bin` / `weixin-credential.bin` | 系统凭据库加密 |
| `pi-sessions/` | 内核会话，对话记录的唯一来源 |
| `checkpoints/<taskId>/` | 文件工具改动前的快照，用于撤销 |
| `memory.json` | 长期记忆，界面可查看和删除 |
| `pi-agent/auth.json` | 内容固定为 `{}`，密钥只在内存里 |
| `transcript.legacy.json` | 0.3 的界面记录，只保留不读取 |

数据目录：macOS 沿用 `~/.local/share/anna-dsh`，Linux 用 `$XDG_DATA_HOME/anna`，Windows 用 `%APPDATA%\Anna`。
