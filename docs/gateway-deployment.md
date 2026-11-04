# Anna Gateway：独立入口部署

状态：第一批轻量数据入口。尚未实现 Anna 工作台、后端自动安装/迁移或一键跨平台安装。它连接一个**已配置好的 New API 后端**，由后端继续校验设备 Key、模型范围、额度和用量；它自身不运行模型、不创建第二套账本。首次没有后端时，可初始化并启动入口，但推理调用返回后端不可用。

## 从 Git 运行

Windows PowerShell、macOS Terminal、Linux shell 使用相同 Node 命令；需要 Node.js 24 或更高版本，仓库的固定版本见 `.nvmrc`。不需要为此入口运行根目录 `pnpm install`、安装 Electron/Python/MLX、下载模型或启用 Tailscale。

```sh
git clone https://github.com/YuanyuanMa03/anna.git
cd anna
# 若功能分支尚未合并，请检出交付记录中指定的分支和提交。
node apps/gateway/cli.mjs init
node apps/gateway/cli.mjs doctor
node apps/gateway/cli.mjs start
```

`start` 前台运行，不注册登录服务；看到 `event: ready` 才表示端口绑定成功。`doctor` 后端不可达或实例无法核实时返回非零，并区分 `backendReachable` 与 `inferenceChecked`。诊断只检查 New API `/api/status`，不会发送模型请求或自动加载模型。

另一个终端停止，或在启动窗口按 Ctrl+C：

```sh
node apps/gateway/cli.mjs stop
```

停止命令通过只在 127.0.0.1 监听的随机控制端口、临时控制凭据验证自己的实例，等待锁释放；不按未知 PID 强杀进程，不操作旧部署的 LaunchAgents 或其他服务。

已有完整开发依赖时，也可使用根目录 `pnpm gateway:init`、`pnpm gateway:start`、`pnpm gateway:stop`、`pnpm gateway:doctor`。独立 Node 命令不依赖这些依赖。

## 目录与配置

默认数据目录：

| 系统 | 位置 |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Anna\Gateway`，未提供时使用用户目录的 `AppData\Local\Anna\Gateway` |
| macOS | `~/Library/Application Support/Anna/Gateway` |
| Linux | `$XDG_DATA_HOME/anna/gateway`，未提供有效绝对路径时使用 `~/.local/share/anna/gateway` |

所有命令都支持明确目录，中文/空格路径用引号包裹，不要使用未展开的 shell 变量：

```sh
node apps/gateway/cli.mjs init --data-dir "./my gateway 数据"
node apps/gateway/cli.mjs start --data-dir "./my gateway 数据"
node apps/gateway/cli.mjs doctor --data-dir "./my gateway 数据"
node apps/gateway/cli.mjs stop --data-dir "./my gateway 数据"
```

`init` 创建 `gateway.json`，已有配置绝不覆盖。修改配置后先停止再启动：

```json
{
  "version": 1,
  "access": "local",
  "host": "127.0.0.1",
  "port": 17864,
  "backendURL": "http://127.0.0.1:17860"
}
```

`backendURL` 指 New API 根地址，无 `/v1` 路径、查询参数或内嵌凭据。本机后端允许 HTTP；远端后端须使用 HTTPS。设备将自己的网关 Key 传入请求；它不会被替换为管理员 Key，上游提供商 Key 留在后端。

数据目录仅保存无密钥配置与运行期 `gateway.lock`；锁中含临时本机控制凭据，不复制、不上传。POSIX 使用 0700/0600；Windows 的 mode 参数不等于 DPAPI 或完整 ACL 保护，请将目录放在仅本人可访问的用户目录，远程管理和系统凭据库集成尚未交付。

同一目录只允许一个实例。异常断电可能留下锁；doctor 显示 unverified 时不会自动删锁/杀进程。先核对本项目启动窗口及进程/端口，确认已退出后，备份并移走 `gateway.lock` 再启动。升级前停止入口、备份配置；保留后端自己的数据库/凭据备份。回退到已验证提交后使用同一配置，不复制数据库到入口目录。

## 接口与连接

入口地址默认为 `http://127.0.0.1:17864/v1`。目前只开放：

- `GET /v1/models`
- `POST /v1/chat/completions`，含 SSE
- `POST /v1/audio/transcriptions`，multipart 原样转发
- `POST /v1/audio/speech`，音频流原样转发

使用 `Authorization: Bearer <设备 Key>`。无 Key 拒绝，有 Key 仍由 New API 验证，后端撤销和额度限制继续生效。`/api/*` 管理接口不转发，数据入口不承载管理页面；带浏览器 Origin 的调用拒绝，不提供任意跨域开放。`GET /healthz` 仅表示入口已监听，不证明后端或模型可用。

每请求上限 20 MiB（包括 multipart 开销）、最多同时转发四个请求、整体超时 120 秒；队满返回 503/Retry-After。客户端断开取消上游 HTTP 请求，不保证后端模型立即停止计算。无自动重试、无重定向跟随。日志仅记录网关请求 ID、白名单路径、状态和耗时，不记录 Key、输入、音频、提供商错误正文或后端地址。模型实际用量由后端负责，入口的请求日志不冒充账本。

局域网需主动将 `access` 改成 `network`、`host` 改为具体网卡 IP 或 `0.0.0.0`，并检查主机防火墙。HTTP 链路未加密，优先配置 HTTPS；不要在不受控网络明文发送 Key。其他设备用服务器的局域网地址，不用 127.0.0.1。修改配置不会自动添加防火墙规则或开放路由器端口。

Tailscale、反向代理、隧道均是入口的可选外层连接方式。公共访问需自行配置有效 HTTPS、访问限制和上游流式传输超时，只发布数据入口 17864；随机控制端口禁止代理。不要直接公开仍带管理界面的后端 17860。已有 Tailscale Serve 仍指向旧部署，本批不改变它。

模型别名须先在后端配置和验证；本批不会自动创建 `anna-chat` 等别名，也不会因调用语言模型而自动启动本地 LLM。

## 验收与已知边界

本地自动测试用模拟后端覆盖配置、管理接口隔离、Key 透传、原始 SSE/用量、ASR multipart、TTS 字节、取消/并发/体积限制、启动停止重启与独占锁。可执行：

```sh
pnpm exec vitest run tests/gateway.test.ts
```

目标机器需另验收干净 Git 部署、Node 版本、路径、权限、防火墙、实际跨设备连接和升级回退。macOS 本机测试不能证明 Windows/Linux 已验收。网关源码没有模型运行依赖；模型节点的系统/架构兼容性独立报告。

这批不覆盖 New API 管理/加额缺陷修复、数据库迁移、额度并发结算准确性或上游许可分发审查；原部署保留作回退，尚不应切换正式设备。工作台及 Anna 内入口将在后续批次接入。
