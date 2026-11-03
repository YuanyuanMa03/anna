# Anna 数字生命首版：实现与验收记录

非对照部分的实现及自动验收已收尾，改动保存在独立验收分支，未发布新版。真实对照与人工盲评按用户要求暂停。

## 已实现的路径

- 连续向导：系统目录选择、信任/只读、大脑卡片、隔离连接验证、人格与偏好、首次任务建议。中断后根据持久状态恢复，已配置用户不强制重做。
- 统一档案：相处偏好、共同记忆、能力、模型与大脑、工作记录。首页保留小型入口，外观制作入口保留。
- 16 型本机抽卡及静态预览；旧四种人格迁移；人格说明跨 pi/Claude Code/Codex 注入。
- 主动提出的记忆先确认，可编辑、纠正、删除、关闭。拒绝候选不重复催问；删除/纠正刷新后续上下文；欢迎语只使用真实已确认记忆与工作记录。
- 共用 pi 模型：兼容预览、初始选择备份、跟随、独立修改退出跟随、恢复、失败回滚、凭据库存储的中断恢复事务。
- Claude Code/Codex 历史：主动分页、详情预览、原目录筛选、显式映射失效目录、原生分支、来源归属及工作目录/大脑会话隔离。
- 实际能力来源和未知状态；Codex 使用稳定技能/MCP接口，不调用生产不支持的插件列表接口。
- 独立额度窗口、真实窗口名称、查询失败保留过期数据；任务实际用量、缓存、工具数、耗时及运行时报告的重试记录。
- 四类按需工作方法；12 个固定任务；离线用量比较、盲评包与单独答案映射。缺少缓存统计或人工偏好时不能标记节省目标达成。

## 已执行的验证

- 完整单元/集成测试、lint、类型检查和生产构建。
- macOS 上 Electron 自动流程：目录取消/选择、权限、连接表单、人格、恢复、共享/恢复、历史分支、能力、独立额度窗口及记忆确认/纠正/删除。
- 临时 Claude 会话文件上的真实 SDK 列表/详情/分支，核对源文件不变；Codex 协议夹具覆盖原生分支及不支持版本。
- DeepSeek/pi 真实 Electron 小任务通过：文件读写、命令确认、状态工具、记忆确认、完整退出后恢复会话。证据：`artifacts/acceptance.json`。
- Codex 0.161.0：真实任务、完整 Host 重启续接、拒绝写入、工具执行时取消通过；真实历史分支创建不同会话，源会话文件 SHA-256 不变。证据：`artifacts/native-codex.json`、`artifacts/history-codex.json`。
- Claude Code 2.1.311：使用已保存登录，真实任务、续接、拒绝、取消及真实历史分支通过。证据：`artifacts/native-claude-code.json`、`artifacts/history-claude-code.json`。当前 shell 注入的第三方模型覆盖曾导致超时；验收仅在该测试进程移除覆盖，不改写用户全局配置。
- 当前 macOS 完整回归 634 项通过、19 项跳过；lint、类型检查、生产构建和桌面自动流程通过。连接验证的隔离权限、超时保留配置另有直接 Host 测试。
- Windows 盘符/UNC/中文空格路径、安装说明和检测逻辑已验证。三平台 Electron 流程覆盖系统目录窗口取消的 IPC 路径、中文空格目录、只读/信任、连接成功后刷新恢复。OS 窗口返回值由夹具控制，不声称已人工操作三个系统的原生窗口。
- 最终运行：[GitHub Actions 41567648268](https://github.com/YuanyuanMa03/anna/actions/runs/41567648268)，运行时源码与测试提交 `efd1518`。`macos-15`、`windows-2025`、`ubuntu-24.04`、`Linux package (Chromium sandbox)` 四个作业全部成功；Linux 包同时通过安装前及安装 AppArmor 配置后的桌面流程与沙箱状态检查。

## 按用户要求暂停的内容

全部真实对照及人工盲评继续暂停。本轮收尾未执行 72 次对照，不将其列作当前交付门槛；比较工具保留供后续明确恢复使用。

目前没有真实成本对照结果，不能宣传已经节省 token。基准测试中的合成计数只是测试比较逻辑的夹具。

## 真实对照执行入口

当前执行器支持内置 pi 的 API 模型，独立加载基线与候选各自的 Host/kernel；只订阅 SDK 原始测量事件，不修改基线源码。基线需为本轮优化之前的独立源码目录，并具备相同依赖。运行前须选择凭据来源，设置 `ANNA_BENCHMARK_KEY`，不会自动读取或改写个人 Anna 凭据库。

```sh
pnpm exec tsx scripts/life-benchmark.ts run /path/to/baseline model.json .data/life-benchmark-run --allow-model-calls
```

`model.json` 仅包含现有 ModelSettings 的 `provider`、`model`、`baseURL`、`api`，不得包含密钥。此命令会真实调用模型，两个组各 36 次任务；每对执行顺序本机随机。输出目录必须不存在，避免覆盖旧证据。每次任务使用新目录和新会话，权限相同；额外升级授权统一拒绝。失败任务照实记录，不通过改测试取得成功。

结果包含源码提交与内容哈希、固定配置哈希、逐次成果/检查、实际模型/用量/耗时/报告的重试，以及原始会话。发生委托但无法完整归集时用量标记不完整。模型与固定值不一致时停止，不能继续生成有效对照。

只向人工评审提供 `review-packet.json`；其中 A/B 随机，去除可能暴露组别的工作目录路径，不提供 token、耗时、检查分数或答案映射。将 36 项偏好填入 `review-votes.json`（`A`、`B`、`tie`）后执行：

```sh
pnpm exec tsx scripts/life-benchmark.ts compare .data/life-benchmark-run
```

`review-key.private.json` 须留在执行者侧。未填完不能声称质量通过；任何缓存字段缺失不能声称节省目标通过。脚本使用情况和测试夹具通过不代表 72 次真实对照已经执行。

## 非对照真实验收命令

```sh
pnpm exec tsx scripts/accept-native-brains.ts codex
pnpm exec tsx scripts/accept-native-brains.ts claude-code --existing-login
pnpm exec tsx scripts/accept-native-history.ts codex <本次验收生成的数据目录>
pnpm exec tsx scripts/accept-native-history.ts claude-code <本次验收生成的数据目录>
pnpm test:desktop
```

这些命令仅用于明确授权的真实小任务，会消耗相应模型额度。`--existing-login` 只在测试进程移除继承的 Anthropic 服务商/模型环境变量，使用本机已保存的 Claude 登录；不会改写 shell 或 agent 配置。历史验收仅允许处理上述脚本创建且任务验收通过的合成会话。原始证据含临时路径及本机能力信息，留在本地忽略目录中，不提交到源码仓库。
