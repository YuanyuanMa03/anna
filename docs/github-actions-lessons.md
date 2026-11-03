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
- CI 的快速检查在资源下载/构建之前；同一分支的新 CI 取消旧 CI，减少重复作业。Release 不使用这个并发组。
- Node、pnpm、runner 和 Actions 版本已固定；依赖使用 frozen lockfile。
- 自动桌面测试统一源码/安装包入口；三个 OS 及 Linux 安装前后沙箱路径均需验证。
- 人工语义审查由助手负责，记录在 `docs/reviews/`；hook 只落实机械检查，不保证代码不存在缺陷。

## 每次推送的顺序

1. 读 base..HEAD 完整 diff，列出影响范围、P0/P1/P2 问题、恢复方式和未验证事项。
2. 修复确认的问题，跑相关测试，再执行 preflight。界面/运行时变化再跑构建和桌面流程。
3. 提交后推送当前分支，检查该提交的 CI，失败读取具体 job 日志。只修复失败根因，不靠删测试、忽略错误或无依据放宽超时通过。
4. 全部必需作业成功后才将其作为合并依据。合并、发版与部署分开处理，归档分支标签不触发发版。
