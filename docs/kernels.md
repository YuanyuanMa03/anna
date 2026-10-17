# 智能体内核与外部 agent

Anna 有两种使用其他 agent 的方式，都基于 `packages/agents/` 的适配器：

- **派活**：pi 是 Anna 的大脑，外部 agent 是她的同事。可以用 `@claude 任务` 点名，也可以由 Anna 调用 `anna_delegate` 工具自己派。实现见 `anna-host/delegator.ts`。
- **换大脑**：在“模型与设置”里把 Anna 的大脑换成 Claude Code 或 Codex。实现见 `kernels/external/kernel.ts`。

## 适配器的组成

| 文件 | 职责 |
|---|---|
| `agents/catalog.ts` | 与 cc-switch 相同的 10 个应用：识别方式、配置目录、安装/升级命令、能力档位 |
| `agents/detect.ts` | 在 PATH 和 nvm/fnm/volta/mise/Homebrew/npm 全局目录中查找，读取版本，调用它们自己的登录状态命令 |
| `agents/launch.ts` | 把 Anna 的模式、服务商、会话、人格映射成各 agent 的命令行参数 |
| `agents/adapters/*` | 把各 agent 的无头输出逐行解码成 Anna 的 `KernelEvent`，并生成授权回复 |
| `agents/runner.ts` | 启动进程、解码、把授权请求交给 Anna 的权限闸门、处理中断 |
| `agents/providers.ts` / `global.ts` | 服务商预设（来自 cc-switch）、派活时注入、应用到全局与恢复 |

## 各 agent 的协议

| agent | 无头协议 | 授权方式 | 续接会话 | 验证 |
|---|---|---|---|---|
| Claude Code | `claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio` | 逐步：`control_request(can_use_tool)` → `control_response` | `--resume` | 真机录制 |
| Codex | `codex app-server`（JSON-RPC） | 逐步：`item/*/requestApproval` → `{decision}` | `thread/resume` | 真机录制 |
| Gemini CLI | `gemini -p --output-format stream-json` | 派活前一次确认，`--approval-mode` 跟随模式 | `--resume` | 按源码实现 |
| OpenCode | `opencode run --format json` | 派活前一次确认，协作/放手模式下加 `--auto` | `--session` | 按源码实现 |
| Pi | `pi --mode json` | 派活前一次确认，规划/谨慎模式下只给只读工具 | `--session-id` | 按文档实现 |

模式映射见 `agents/launch.ts`。Claude Code：规划 → `plan`，谨慎 → `default`，协作和放手 → `acceptEdits`。Codex：规划 → `untrusted` + `read-only`，谨慎 → `untrusted` + `workspace-write`，协作和放手 → `on-request` + `workspace-write`。放手模式下，风险较高的请求仍会经过 Anna 的闸门，其余直接放行。凭据目录会作为 deny 规则传给 Claude Code（`--settings`）。

## 新增一个 agent

1. 在 `catalog.ts` 里加一条（如果 cc-switch 已经支持，与它保持一致）。
2. 用 `scripts/record-agent.mjs` 录一段真实会话放进 `tests/fixtures/agents/`（脚本会去除个人信息），或者按它的公开协议写一段合成样本。
3. 写解码器，用 `tests/agents-decoders.test.ts` 回放样本验证。
4. 在 `launch.ts` 里加上参数映射，在 `tests/agents-launch.test.ts` 里加用例。
5. 跑 `tests/host-delegation.test.ts`（使用假 agent）。有真实 CLI 时，再跑 `ANNA_REAL_AGENTS=<id> pnpm test tests/agents-real.test.ts`。
