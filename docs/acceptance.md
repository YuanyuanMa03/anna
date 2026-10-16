# 本机验收记录

日期：2026-10-16，Asia/Shanghai。
环境：macOS arm64，pnpm 10.33.0，开发 Node 26.7.0。
桌面：Electron 44.7.0，内嵌 Node 24.21.0，Chromium 152.0.7977.130。
模型：用户授权复用的智谱 glm-5.3，Anthropic Messages 协议。

## 已执行检查

- `pnpm typecheck`：通过。
- `pnpm test`：4 个文件、9 项测试通过。
- `pnpm lint`：通过。
- `pnpm build`：通过。存在 Live2D 非模块脚本及渲染 bundle 大小提示。
- `node tests/unconfigured.mjs`：通过。无密钥时显示配置表单，不生成假对话。
- `pnpm test:desktop`：使用真实 Electron、真实 DSH 子进程和真实模型执行。

完整退出及恢复后，还再次实际调用了重新启用的状态工具，返回了真实版本与插件信息。

最新完整桌面结果在 `artifacts/acceptance.json`。
自动化使用独立测试数据目录，不覆盖用户当前对话。

## 桌面验收内容

1. 逐个加载 Hiyori、Haru、Mark，并保存真实截图。
2. 逐个比较两帧，检查动画实际前进。
3. 在标准窗口及 900×680 窗口检查 Mark，鞋底完整可见。
4. 输入“Anna，你好，介绍一下你自己。”，检查 DSH 实际模型回复。
5. 请求状态工具，检查正式 Tool 调用与返回事件。
6. 禁用插件，检查工具注册表为空，并检查旧子进程已退出。
7. 请求已禁用工具，检查没有正式 Tool 事件。
8. 重新启用插件，检查工具恢复，并保留相同 Session ID。
9. 完整退出应用，再启动应用，通过正式恢复接口恢复 Session。
10. 让模型复述重启前的随机验收暗号，检查上下文实际连续。
11. 检查 Renderer 没有 page error，退出后 DSH PID 不存在。

## 调试中发现并修复的问题

- 旧 Electron 38 的 Node/V8 指纹不被当前 DSH 原生加载器支持。固定到明确支持的 Electron 44.7.0。
- Electron ESM 入口等待 `app.whenReady()` 的顶层 await 阻塞启动。改用异步入口函数。
- Preload 依赖的 Node crypto 不适用于 sandbox。改用浏览器目标打包 Eventa，保留 sandbox。
- Pixi 动态代码生成与 CSP 冲突。显式安装官方 `@pixi/unsafe-eval` 适配，CSP 不增加 unsafe-eval。
- DSH 工具 payload 位于 `event.data`。使用正式事件校验器并按调用 ID 关联结果。
- Mark 原有正向位移容易造成底部裁切。新舞台按完整模型边界居中适配，不沿用越界位移。
- 工具禁用后，模型曾把历史工具结果伪装成本轮结果。动态人格上下文现在明确实际工具清单。
  UI 单独标示正式工具活动，未发生调用时显示“本轮没有实际工具调用”。

先前工具文本问题的原始输出保存在 `artifacts/acceptance-before-tool-context-fix.json`。
模型文本与真实工具事件属于不同证据，不能仅凭模型声称调用成功就认定工具执行。

## 依赖安装记录

开发 Node 26 下，Electron 安装器曾未完成 ZIP 解压。
本机已从 Electron 官方 release 获取固定版本归档，核对随包 checksums.json 的 SHA-256，再用 macOS ditto 解压。
当前 `pnpm dev:desktop` 不需要重复处理。
未修改 DSH 或 Electron 的依赖源码。

## 验证边界

该验收证明当前环境中的工程链路，不证明模型始终遵循人格或不会产生幻觉。
DeepSeek 官方 Provider、自定义 OpenAI 协议需要对应凭据另行验收。
系统朗读入口及口型状态联动已实现，尚未验证听感或音素同步精度。
本次没有签名安装包、STT、麦克风输入或长期记忆系统。
