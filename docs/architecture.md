# Anna 与 DSH 的边界

Renderer 仅访问 Preload 暴露的固定 Anna Bridge。它不能直接访问 Node、密钥或 DSH 服务。
Electron Main 通过 Eventa 接收产品命令，验证调用窗口并交给 Host。
Host 是配置及进程的单一所有者，不实现 Agent Loop。

`Runtime` 使用正式 `DeepSeekHarness`。其 `client` 是正式 `HarnessClient`，通过 stdio JSON-RPC 驱动 DSH。
SDK 使用 Electron 的受支持 Node 模式启动 `dsh --profile anna`。
DSH 从 Anna 独立 Home 中装配 `sdk-minimal` 与产品 Patch。
Patch 加载两个 Anna Cordis 插件，移除面向模型的 shell 和文件操作工具。
启动后由实际插件凭据和工具注册表确认组合结果。

Host 通过 `EventAdapter` 将 DSH 的持久事件转换为稳定产品事件。
工具调用通过 DSH `callId` 与 `toolCallId` 配对。
版本相关事件解析只存在于 `packages/dsh-client/`，前端不导入 DSH。

退出时等待 SDK 的关闭流程。SDK 依次请求 shutdown、关闭 stdin，并在必要时终止及回收进程。
重组必须等待旧进程结束，不能并行打开相同 Session 的两个写入者。
会话恢复使用正式持久化接口，与界面聊天记录缓存完全分离。

## Soul 演进

今天只有 `anna-persona` 与 `anna-status` 两个实际插件。
未来的 Memory、Relationship、Perception、Action、Proactivity、Goals 和 Reflection 分别拥有自己的数据与生命周期。
新增能力使用 DSH 的正式 Tool、System Prompt、Session 与 Cordis 服务扩展点。
这些能力不要求修改主要 Agent Loop，也不自动获得 shell、网络或文件权限。

外观清单、人格文本、模型设置和系统声音分别拥有自己的配置。
外观不包含 Session ID，切换外观仅更新 Host 的角色文件及 Renderer 模型。

## 安全迁移记录

旧目录为 `~/git/Anna`。该机器文件系统不区分大小写。
新目录为 `~/git/anna-dsh`，与旧目录不是同一 inode。
旧目录及其 Git 历史均保留。未跟踪的 `.zcode/` 未改动。

开始测试前，已生成 `~/Anna-backups/2026-10-16-before-dsh/anna.bundle`，并通过 `git bundle verify`。
角色及 Core 资产另存于同一备份目录。新项目只复制角色资产与许可。
模型凭据按用户明确授权只读复用，再由系统加密保存。
没有导入旧会话、旧 Runtime 或兼容代码，没有修改全局旧配置，没有推送远程。
