# GitHub 推送与 Actions 踩坑记录

2026-11-03 核对最近 35 次工作流中的 10 次失败。多平台和分支/main 重复触发会把同一错误放大为多条红灯。

| 失败类型 | 次数 | 日志证据 | 预防 |
|---|---:|---|---|
| Windows ACP 进程启动/通信 | 5 | [路径语法错误](https://github.com/YuanyuanMa03/anna/actions/runs/41178875917)、[后续 5 秒超时](https://github.com/YuanyuanMa03/anna/actions/runs/41179147343) | 先验证进程启动，再测协议；Node + 参数数组，处理 Windows shim。不能把超时直接归为网络故障 |
| Windows 路径断言 | 1 | [Unix 前缀和盘符假设](https://github.com/YuanyuanMa03/anna/actions/runs/41389227885) | 原生路径函数、临时目录和路径关系断言 |
| Linux 新桌面测试启动入口 | 2 | [新流程无法启动 Electron](https://github.com/YuanyuanMa03/anna/actions/runs/41566278446) | 三个流程统一 `desktopLaunch`；实际包使用该平台的包入口，保留 Linux 启动器的沙箱决策 |
| README 格式 | 2 | [连续空行触发 lint](https://github.com/YuanyuanMa03/anna/actions/runs/41372660988) | 文档也跑 lint，提交/推送前检查，不能只依据旧提交的绿色状态 |

## 当前版本已落实

- `pnpm hooks:install` 为当前 clone 安装 `.githooks/pre-push`；`pnpm preflight` 是统一检查命令。Git 不会自动信任新 clone 的 hook，换电脑/重新 clone 后必须重新安装。
- Hook 校验推送的是当前干净 HEAD，然后运行 lint、类型和测试；失败立即拦截。归档标签和删除旧分支不拿无关工作区冒充验证。
- CI 与 Local hearing 改为仅手动触发，不在每次 push、PR 更新或 main 合并时自动跑矩阵。保留全部平台作业和同分支取消旧作业；Release 的显式版本 tag/手动触发不变。
- Node、pnpm、runner 和 Actions 版本已固定；依赖使用 frozen lockfile。
- 自动桌面测试统一源码/安装包入口；三个 OS 及 Linux 安装前后沙箱路径均需验证。
- 人工语义审查由助手负责，记录在 `docs/reviews/`；hook 只落实机械检查，不保证代码不存在缺陷。

## 每次推送的顺序

1. 读 base..HEAD 完整 diff，列出影响范围、P0/P1/P2 问题、恢复方式和未验证事项。
2. 修复确认的问题，跑相关测试，再执行 preflight。界面/运行时变化再跑构建和桌面流程。
3. 提交后推送当前分支，不自动追加 hosted CI。运行时/部署改动在稳定候选版本集中做三平台及 Linux 安装包验收：优先已有目标机，缺机器时手动运行一次 CI 矩阵；听觉行为/依赖有变才另跑真实听觉矩阵。文档改动只做本地 lint 和审阅。
4. 证据绑定本次提交 SHA、系统/架构、命令、结果与产物。失败先读取具体日志、定位根因并尽可能本地复现修复，再跑受影响的验收；不靠删测试、忽略错误、无依据放宽超时或重跑整套矩阵碰运气。合并、发版与部署分开处理。

## 2026-11-04：本地优先与额度约束

- 用户明确要求节省 GitHub 额度和等待时间，助手负责本地代码审阅；不额外请求付费/自动 PR reviewer 来替代审阅。
- 不减少三平台适配要求：Mac 通过不代表 Windows/Linux 可部署；Docker 通过不代表 Windows 原生安装已通过，arm64 也不代表 Intel x64 已通过。
- 日常流程为“完整 diff 审阅 → 修复 → 针对性验证 → 必需的本地检查”；同一树检查已通过且无新增风险时，不重复跑检查来制造验证次数。
- `ci.yml`、`local-hearing.yml` 的变更只减少触发频率，不删除测试、平台或失败条件。需要补目标平台证据时才集中手动验收。未推送前，GitHub 远端仍使用旧触发规则；本地文件修改不会立即改变远端行为。
- 不为省额度自动注册 self-hosted runner，也不后台占用用户机器；已有目标机可按文档直接运行同一验收命令。
- 本批推送暴露 Hook 边界：`git push origin HEAD` 的本地 ref 是 `HEAD`，旧逻辑只识别 `refs/heads/*`，因此漏检。修复为按远端目的 ref 判定分支/发布标签，并用失败检查返回码测试复现；显式 SHA 推分支同样须验证，不能因为换了推送写法跳过本地检查。

## macOS 打包测试：新签名与钥匙串

感官分支的源码 CI 已绿，首次本机自签名包仍停在测试服务商配置。采样 Main 进程确认阻塞在 `SecItemCopyMatching`，新签名包正在等待钥匙串授权；不是请求网络超时，延长页面等待没有用。

- 自动验收使用临时数据和脚本模型。macOS 打包时由统一启动器额外开启 `ANNA_TEST_VAULT=file`；Main 只有同时存在 `ANNA_TEST_SCRIPT` 时才接受它。正常启动仍使用系统凭据库，不能把测试措施变成生产环境自动降级。
- 凭据测试报告须记录实际 `secretsMode`。文件夹具验证配置、遮蔽和持久化；它不证明 macOS 钥匙串或 Windows DPAPI 已验收。真实系统存储的边界由独立验收记录。
- 卡住时先观察现有进程并取样，明确需要原生授权后，仅结束自有测试进程；不要修改用户钥匙串 ACL、复用真实密钥、无依据增加超时或启动多个重叠的测试包。
