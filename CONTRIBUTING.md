# 开发与 review

新 clone 后运行 `pnpm install --frozen-lockfile`，再运行 `pnpm hooks:install` 安装当前仓库的推送前检查。

提交前审查完整 diff，执行 `pnpm preflight`。桌面或运行时有改动时，还需 `pnpm build` 和 `pnpm test:scripted`；三平台最终证据以当前提交的 CI 为准。自动检查不能代替代码审查，review 发现、修复与限制记录在 `docs/reviews/`。

- [助手工作与 review 规则](AGENTS.md)
- [GitHub / Actions 踩坑及预防](docs/github-actions-lessons.md)
- [旧分支归档与恢复](docs/branch-archives-20261103.md)

真实模型对照保持暂停。归档标签与正式版本标签分开；分支归档不发布新版本。
