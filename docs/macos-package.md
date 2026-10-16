# macOS 应用交付

2026-10-16，macOS 15.7.1，Apple Silicon arm64。

## 产物

- 安装位置：`~/Applications/Anna.app`。
- 构建产物：`dist/macos/Anna.app`。
- 安装镜像：`dist/macos/Anna-0.2.0-arm64.dmg`。
- Bundle ID：`com.yuanyuanma.anna`。
- Anna 版本：0.2.0。
- Electron：44.7.0，内嵌 Node 24.21.0。
- DSH Runtime 与 SDK：0.2.1-alpha.4。

应用包含生产依赖闭包、三个完整角色、Cubism Core、许可证、Anna Profile 和两个 Cordis 插件。
应用不需要用户另外安装 Node、pnpm 或 DSH，也不连接开发服务器。
打包脚本检查 3320 个符号链接，全部指向应用包内部。
应用包约 988 MiB，DMG 约 442 MiB。DSH 官方生产依赖包含可选功能的依赖代码，默认 Profile 只启用本次所需能力。

打包使用 Electron 官方预编译应用结构，不增加第三方打包框架。
仅复制白名单中的构建输出、生产依赖、人格文本、Profile、许可和版本元数据。
不复制 `.env`、用户设置、密钥、会话、聊天记录或测试数据。

## 原生集成

- Anna 应用名称、Bundle ID、图标和关于面板。
- Anna、编辑、窗口菜单。
- 设置菜单及 Cmd+, 快捷键。
- 单实例检测与再次打开时激活窗口。
- 独立用户数据目录及启动错误提示。
- Packaged 模式忽略开发服务器和源码目录环境覆盖。
- 应用退出等待 SDK 回收 DSH 子进程。

## 实际检查

- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：4 个文件、9 项测试通过。
- `pnpm package:mac`：生成完整应用，严格签名校验通过。
- `ANNA_PACKAGED_APP=.../Anna.app pnpm test:desktop`：完整打包版验收通过。
- `pnpm package:dmg`：生成镜像，`hdiutil verify` 通过。
- `./script/build_and_run.sh --verify`：一键构建、覆盖安装及启动检查通过。
- 打包版缺凭据检查通过：真实配置表单、空聊天记录、无假回复。
- 只读挂载 DMG 后运行 `tests/packaged-smoke.mjs`：真实 DSH、角色模型和原生设置菜单通过。
- 安装后的应用从 `/` 启动，PATH 只有系统目录，且源码目录和开发服务器地址故意无效：正常启动。
- 安装后的应用恢复 Mark、用户模型配置及原 Session，保留原有两条消息。
- 退出测试实例后，通过 LaunchServices 的 `open -n` 启动实际安装的应用。

完整打包版验收包括三个角色的真实动画、真实模型对话、工具调用、插件禁用/恢复、跨重启暗号和 DSH 进程回收。
测试期间曾发生验收窗口关闭，以及隐藏窗口导致截图帧等待超时。验收改为不抢焦点的窗口后完整通过。
没有发现对应的 Anna 崩溃报告，不能将窗口关闭归因为已确认的产品崩溃。

证据文件：

- `artifacts/acceptance-packaged.json`
- `artifacts/packaged-smoke.json`
- `artifacts/installed-anna.json`
- `artifacts/mac-sign-status.json`
- `artifacts/installed-anna.png`

## 签名与分发边界

Mac Sign 已检查并实际尝试证书签名。系统当前有 0 个有效代码签名身份，证书签名失败。
工具错误为：`Expected one usable identity`。

当前应用由 macOS codesign 完成本机 ad-hoc 签名，29 个 Mach-O 文件及 10 个可执行 Bundle 从内到外封装。
`codesign --verify --deep --strict` 通过。
这不代表 Apple 证书签名或公证成功。应用没有 Team ID，`spctl --assess --type execute` 返回拒绝。

当前交付已在本机正常启动。对外分发需要有效 Developer ID 签名、相应运行配置和 Apple 公证。
没有关闭 Gatekeeper，没有导出私钥，也没有改动钥匙串 ACL。

## 重建与安装

`script/build_and_run.sh` 提供单一入口：停止已知 Anna 进程、构建、严格校验、覆盖安装、启动。
`--build` 仅构建，`--verify` 追加启动进程检查，`--debug` 使用 LLDB，`--logs` 查看进程日志。

Mac Sign 配置位于 `.ai-sign.json`。构建命令为 `pnpm package:mac`，不会在构建前结束运行中的用户应用。
构建脚本先生成本机 ad-hoc 产物。使用证书签名时，必须在构建后签名，再制作 DMG。

安装脚本只覆盖 Bundle ID 匹配的 `~/Applications/Anna.app`，先校验临时副本，再原子替换。
旧版应用已删除，用户设置和会话未删除。
安装前的数据快照保存在 `~/Anna-backups/2026-10-16-before-macos-install/anna-dsh/`。
原始源码工作区和之前的恢复备份未在应用替换过程中改动。
