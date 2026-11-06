# 分支归档（2026-11-03）

首次清理时保留 main、当前数字生命开发分支、在线版主线，以及 3 个未关闭 PR 的分支，共 6 个；后续处理结果见末尾。所有已清理分支先用远端轻量标签归档，验证 SHA 后才删除；本地与远端不同的版本分别保存。旧工作树保持文件原状，改为 detached HEAD。

恢复示例：`git switch -c recovered-name archive/20261103/local/原分支名`。归档标签不使用 v 前缀，不触发 Release。

| 来源 | 原分支 | 提交 | 归档标签 |
|---|---|---|---|
| local | chore/pin-toolchain | 2a39bc8f2c785ef49f061837c4c87acf8c41167a | archive/20261103/local/chore/pin-toolchain |
| local | chore/release-v0.5.0 | fabdc7e204ee8fd03095be30c77d086aa17725f1 | archive/20261103/local/chore/release-v0.5.0 |
| local | chore/release-v0.5.1 | 6b31b93718cf142f43cc040360b7a0c15a132dca | archive/20261103/local/chore/release-v0.5.1 |
| local | ci/release-as-draft | 464307c46072faafffd1fa938030145a76f92891 | archive/20261103/local/ci/release-as-draft |
| local | claude/modest-lamarr-68cee0 | a3304d9676fa80e34083c23e36a98c2e46c26fe5 | archive/20261103/local/claude/modest-lamarr-68cee0 |
| local | deploy/modelscope-links | ba961beb63ceb87435c3686008cccf73782213e2 | archive/20261103/local/deploy/modelscope-links |
| local | docs/only-anna | a4992e17512f7ec82f8b89f245e5584964d9c9ab | archive/20261103/local/docs/only-anna |
| local | docs/voice-and-comparison | c1cbe2d45a3510defda65fa39a2b8912ab839188 | archive/20261103/local/docs/voice-and-comparison |
| local | feat/acp-kernel | b6491cf9a939a7a7488cf2ace6bd07443afad00c | archive/20261103/local/feat/acp-kernel |
| local | feat/anna-body | d0dfb5acfcbadb42fb1014f0d923aa5609d79696 | archive/20261103/local/feat/anna-body |
| local | feat/anna-presence | ac3713bf929d9cd8cfb05e7e3c5a08b18bfe74ff | archive/20261103/local/feat/anna-presence |
| local | feat/brain-picker | fb02cb403ed84f7818c2f568830165cc48ef8928 | archive/20261103/local/feat/brain-picker |
| local | feat/make-your-anna | 7534dc34430e041583bea31c2254b5268f276dc5 | archive/20261103/local/feat/make-your-anna |
| local | feat/memory-provenance | 0fb880d3b165e313c8417dbdb4a4900a4aafb831 | archive/20261103/local/feat/memory-provenance |
| local | feat/online-on-main | 3eb7a90d6cd8312cfe0087aaf6a7617436987244 | archive/20261103/local/feat/online-on-main |
| local | feat/only-anna | 00263564c6bfb5caa3b796dc8f0bd736da33bf51 | archive/20261103/local/feat/only-anna |
| local | fix/brain-knows-today | 5763465924498ef3ab5f5082822e4e1cb8a7301d | archive/20261103/local/fix/brain-knows-today |
| local | fix/local-version-display | 214e762b384f121840f4dd2a7036d31eaa43b941 | archive/20261103/local/fix/local-version-display |
| local | fix/memory-review | 1e13e9a188792ae41b4e148d44975d816e28886b | archive/20261103/local/fix/memory-review |
| local | fix/online-proxy-diagnostics | b2eeab792c7c2ee00d41897e4ad6756f4bf4e6e5 | archive/20261103/local/fix/online-proxy-diagnostics |
| local | fix/online-session-limits | 8d76282f8f465b564b0bf53b87371e86a36c77cc | archive/20261103/local/fix/online-session-limits |
| local | fix/portrait-stability | 62bfa5cb3102ed09f7a8f056016f09e72daceabb | archive/20261103/local/fix/portrait-stability |
| local | fix/review-v051 | c67c5f81d1967e5e5c4fac89cf156c1d6759ff71 | archive/20261103/local/fix/review-v051 |
| local | fix/stack-review | 9dd4939f88b1d914039bdaf68d5464f710868bc6 | archive/20261103/local/fix/stack-review |
| local | fix/takeover-restore | 8189e2d44b97bc72193f9887b3e5ae35aa1043bc | archive/20261103/local/fix/takeover-restore |
| local | proto/anna-clips | 456c520c0108bdcfac65c6a79cdddf7411cc1783 | archive/20261103/local/proto/anna-clips |
| local | proto/live2d-room | ef4c300c58ce23b24bc7e40aa18764ef95700c27 | archive/20261103/local/proto/live2d-room |
| local | work/copy | 0eb225fd69da496e938857aef79c5e3d57e8890d | archive/20261103/local/work/copy |
| local | work/finals | 91d93d89bff58e64ba5fbcd2f272597665267bfb | archive/20261103/local/work/finals |
| local | work/online | e28ffb78c0e2ca3e45a9fd4f6667f001a9cf2890 | archive/20261103/local/work/online |
| local | work/online-preserved | 3eb7a90d6cd8312cfe0087aaf6a7617436987244 | archive/20261103/local/work/online-preserved |
| remote | chore/pin-toolchain | e476a6bfac69586742544e4ce3f3ebcf0881dad6 | archive/20261103/remote/chore/pin-toolchain |
| remote | chore/release-v0.5.0 | fabdc7e204ee8fd03095be30c77d086aa17725f1 | archive/20261103/remote/chore/release-v0.5.0 |
| remote | chore/release-v0.5.1 | 6b31b93718cf142f43cc040360b7a0c15a132dca | archive/20261103/remote/chore/release-v0.5.1 |
| remote | ci/release-as-draft | 464307c46072faafffd1fa938030145a76f92891 | archive/20261103/remote/ci/release-as-draft |
| remote | deploy/modelscope-full | ba961beb63ceb87435c3686008cccf73782213e2 | archive/20261103/remote/deploy/modelscope-full |
| remote | docs/only-anna | 91d93d89bff58e64ba5fbcd2f272597665267bfb | archive/20261103/remote/docs/only-anna |
| remote | docs/voice-and-comparison | c1cbe2d45a3510defda65fa39a2b8912ab839188 | archive/20261103/remote/docs/voice-and-comparison |
| remote | feat/acp-kernel | b6491cf9a939a7a7488cf2ace6bd07443afad00c | archive/20261103/remote/feat/acp-kernel |
| remote | feat/anna-body | d0dfb5acfcbadb42fb1014f0d923aa5609d79696 | archive/20261103/remote/feat/anna-body |
| remote | feat/anna-presence | ac3713bf929d9cd8cfb05e7e3c5a08b18bfe74ff | archive/20261103/remote/feat/anna-presence |
| remote | feat/brain-picker | fb02cb403ed84f7818c2f568830165cc48ef8928 | archive/20261103/remote/feat/brain-picker |
| remote | feat/make-your-anna | cb6dde69a239d3e70b54b9090f7e3d6688a7db6a | archive/20261103/remote/feat/make-your-anna |
| remote | feat/memory-provenance | 0fb880d3b165e313c8417dbdb4a4900a4aafb831 | archive/20261103/remote/feat/memory-provenance |
| remote | feat/only-anna | f60075c1b3e3b67ea1ff6874fb444735d10a88b3 | archive/20261103/remote/feat/only-anna |
| remote | fix/brain-knows-today | 5763465924498ef3ab5f5082822e4e1cb8a7301d | archive/20261103/remote/fix/brain-knows-today |
| remote | fix/local-version-display | 42b942bd2182a02e83b1bdbb940d62873f8221c4 | archive/20261103/remote/fix/local-version-display |
| remote | fix/memory-review | 1e13e9a188792ae41b4e148d44975d816e28886b | archive/20261103/remote/fix/memory-review |
| remote | fix/online-proxy-diagnostics | b2eeab792c7c2ee00d41897e4ad6756f4bf4e6e5 | archive/20261103/remote/fix/online-proxy-diagnostics |
| remote | fix/online-session-limits | 8d76282f8f465b564b0bf53b87371e86a36c77cc | archive/20261103/remote/fix/online-session-limits |
| remote | fix/portrait-stability | 62bfa5cb3102ed09f7a8f056016f09e72daceabb | archive/20261103/remote/fix/portrait-stability |
| remote | fix/review-v051 | c67c5f81d1967e5e5c4fac89cf156c1d6759ff71 | archive/20261103/remote/fix/review-v051 |
| remote | fix/stack-review | 9dd4939f88b1d914039bdaf68d5464f710868bc6 | archive/20261103/remote/fix/stack-review |
| remote | fix/takeover-restore | 8189e2d44b97bc72193f9887b3e5ae35aa1043bc | archive/20261103/remote/fix/takeover-restore |

## PR 处理后的最终分支

用户要求完成残留 PR 后，#44 归档关闭，#46 合并 main，#47 修订后合并在线主线，三个 PR 分支均已删除。当前本地和远端仅保留：

- `main`
- `work/anna-life-v1-20261103`
- `release/online-v0.6.0`

完整恢复标签：`archive/20261103/pr-44`、`archive/20261103/pr-46`、`archive/20261103/pr-47`。所有历史归档继续保留；没有通过强推改写历史。

## 2026-11-06: 1.0 consolidation

The 1.0 candidate was committed to `release/v1.0` (based on `1149134`, which contains every commit of the branches below). Covered branches and the stash were tagged, the remote tag SHAs were verified, and only then deleted. `release/online-v0.6.0` stays.

| Source | Original | Commit | Archive tag |
|---|---|---|---|
| local | codex/desktop-voice-slim | 11491342b8b57c1ba718257d8bedc1fc83fb3abb | archive/20261106/local/codex/desktop-voice-slim |
| remote | codex/desktop-voice-slim | 11491342b8b57c1ba718257d8bedc1fc83fb3abb | archive/20261106/remote/codex/desktop-voice-slim |
| local | work/anna-senses-v1-20261103 | 4e19b91b8bfc988e41c515d9d5a7deb431ce1a8d | archive/20261106/local/work/anna-senses-v1-20261103 |
| remote | work/anna-senses-v1-20261103 | 4e19b91b8bfc988e41c515d9d5a7deb431ce1a8d | archive/20261106/remote/work/anna-senses-v1-20261103 |
| remote | work/anna-life-v1-20261103 | 9f65ac6a2a312962205f9d78fa7a072b6f31ab24 | archive/20261106/remote/work/anna-life-v1-20261103 |
| stash | stash@{0} "startup reliability work on main base" | 8343c04d5d34ae477f19717daf7e55626d319f47 | archive/20261106/stash/startup-reliability-main-base |

`fix/install-and-startup-reliability` pointed at `main` (bbc9279) and was deleted without a tag. The local-only `release/v1.0-windows` (1149134) was replaced by `release/v1.0`, which contains it. The stash's changes were checked line by line against the 1.0 candidate; its `scripts/package-runtime.mjs` pruning was superseded by the rewritten `stage-runtime.mjs`. Restore a stash with `git stash apply archive/20261106/stash/startup-reliability-main-base`.

Remaining branches: `main`, `release/v1.0`, `release/online-v0.6.0`.
