# 规格：外部 agent 与无签名分发

> 状态：已实现（2026-10-17）。实现以本文为准；改动先改本文。
>
> 与规格的差异：
> - Git 仓库“独立 worktree 运行”尚未实现，目前同一工作区里的派活按顺序执行。
> - Gemini CLI、OpenCode、Pi 的适配器按官方协议和源码实现，没有在真机上录制验证（界面标注“未真机验证”）。Claude Code 和 Codex 已在真机上完成派活、授权和换大脑的验证。
> - 换大脑到 Claude Code / Codex 时，Anna 自带的工具（记忆、状态、派活）不可用；人格、权限模式、记忆说明会注入它们的系统提示。

## 1. 外部 agent

### 1.1 角色
- **先做派活**：pi 仍是 Anna 的大脑，外部 agent 是她可以调度的“同事”。
- **最后做换大脑**：复用派活适配器，在设置里选择 Anna 的大脑：pi / Claude Code / Codex。

### 1.2 识别（参照 cc-switch）
- 识别 cc-switch 支持的全部应用：Claude Code、Claude Desktop、Codex、Gemini CLI、Grok Build、OpenCode、OpenClaw、Hermes、Pi、MiniMax Code。
- 搜索范围除 PATH 外，还包括 `~/.local/bin`、Homebrew、npm/pnpm/bun 全局目录，以及 nvm、fnm、volta、mise 的 Node 目录（图形界面应用继承不到终端的 PATH）。
- 每个 agent 报告：是否安装、路径、版本（`--version`）、是否已登录（只调用它自己的 status 命令，不读凭据文件）、配置目录、能力档位。
- 能力分两档：
  - **派活 + 切换服务商**：Claude Code、Codex、Gemini CLI、OpenCode、Pi。
  - **仅识别 + 切换服务商**：Claude Desktop、Grok Build、OpenClaw、Hermes、MiniMax Code。
- 提供安装/升级命令（与 cc-switch 相同：`npm i -g <包>@latest` 或官方安装脚本），执行前需要用户确认。

### 1.3 接入
- 调用用户已安装的 CLI 的无头协议，不打包 SDK：
  - Claude Code：`claude -p --output-format stream-json --verbose`，用 `--resume` 续接，用 `--permission-mode` 映射模式，授权通过 `--permission-prompt-tool` 转接给 Anna。
  - Codex：`codex exec --json`（app-server 可用时优先用 app-server），用 `resume` 续接，用 `-s` 设置沙箱。
  - Gemini CLI / OpenCode / Pi：各自的无头 JSON 流。
- 适配器只做两件事：调用 Anna 的权限闸门，把事件归一化为 `KernelEvent`。

### 1.4 服务商
- Anna 自己维护服务商库，预设复用 cc-switch（MIT，注明出处），并附带同步脚本。
- **派活时临时生效（默认）**：服务商只通过子进程的环境变量或 `-c` 参数注入，不改任何文件。
- **应用到全局**：按 cc-switch 的规则写入各 CLI 的配置：只改关键字段、保留原有格式、首次写入前备份原文件、写完重新读取比对、读不懂就不写；可以一键恢复原配置。
- 检测到 cc-switch 时，只读导入它的服务商，并提示用户不要两边同时切换。
- Anna 的大脑和所有被派活的 agent 都不能读写 `~/.claude`、`~/.codex` 等目录，只有 Host 能写。

### 1.5 派活
- 用户点名：`@claude …`、`@codex/glm …`。
- Anna 自己派活：使用 `anna_delegate(agent, task)` 工具。规划和谨慎模式下先问用户，协作和放手模式下直接派。
- 权限：Anna 的模式映射到 agent 的原生设置（见 `permissions/modes.ts`）。agent 的授权请求转成 Anna 的确认卡；微信来源的任务按“谨慎”执行。
- 同一个工作区同时只运行一个外部 agent，其余排队。Git 仓库可以选择在独立 worktree 里运行。
- 每次派活前给工作区拍快照（Git 仓库用 `git stash create`，非 Git 目录复制会被改动的文件），交付卡提供 diff 和撤销。
- 记录每个 agent 的会话 ID；接着对同一个 agent 说话时续接原会话。对话记录里，每次派活显示为一个可折叠块；另有派活会话浏览。
- Live2D：Anna 进入“督工”姿态；舞台显示协作者卡片（agent、服务商、步骤）；结果由 Anna 用自己的口吻转述。

## 2. 分发（不申请 Apple 开发者账号）

- **签名身份**：使用自签名代码签名证书“Anna Local Signing”，所有版本都用它签名。这样钥匙串授权和文件夹授权在升级后都会保留。
- **安装**：
  - macOS：`curl -fsSL …/install.sh | bash`，装到 `~/Applications`。curl 下载不带隔离标记，因此不会有 Gatekeeper 弹窗。
  - Windows：`irm …/install.ps1 | iex`，装到 `%LOCALAPPDATA%\Programs\Anna`。
  - Linux：`install.sh` 装到 `~/.local/share/anna-app`，并生成桌面启动项。
- **应用内更新**：下载新版本、校验 SHA-256、替换并重启。
- **密钥**：所有密钥合并成一条加密记录，启动时读一次，之后放在内存里。Linux 没有系统钥匙串时，退回到 0600 权限的文件，并在界面上提示。

## 3. 本轮不做
MCP/Skills 同步、用量统计（下一轮）；本地代理与故障切换。
