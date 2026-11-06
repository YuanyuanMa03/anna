# 本地优先与手动跨平台验收审阅

2026-11-04。按用户要求减少 GitHub 消耗；没有触发任何 Actions、模型调用或 PR 审阅。

## 变更与审阅

- `ci.yml` 删除自动 PR/main push 触发，只保留 workflow_dispatch；`local-hearing.yml` 删除分支 push/PR 自动触发，只保留 workflow_dispatch。平台矩阵、步骤、超时、权限、并发和失败处理均未改变；Release 未改。
- 审阅本轮完整 diff；开发约束与网关方案明确本地审阅、稳定候选集中验收，以及三平台/架构证据要求。原有 pre-push 检查未放宽。
- 只读查询 GitHub：main protection 返回 Branch not protected（404），rulesets 列表为空；未修改远端规则。当前未发现强制自动状态检查与手动触发冲突，后续远端设置变化需重查。
- 风险：普通推送不再产生自动远端验收，必须遵守合并前候选版本验收约束。旧运行不会因本地改文件而取消；远端触发规则要在对应分支推送后才更新。精确提交证据不能用旧绿色结果替代。

## 验证

- `pnpm lint` 通过，包含 YAML 与 Markdown 检查；`git diff --check` 通过。
- 使用已安装 YAML 解析器解析两个工作流，断言触发器只有 workflow_dispatch，并与 HEAD 版本对比：除触发器与注释外，jobs、矩阵、权限、并发等配置完全一致；Release diff 为空。
- 审阅完整 tracked diff、新增本轮审阅记录及方案中的部署矩阵，没有运行时代码变更；不为本轮重复运行类型、应用构建或推理测试。
- 回退可从原 HEAD 恢复两个工作流的触发段，不影响数据或运行服务。当前变更未提交/推送，远端规则尚未生效。
- 没有启动本地语言模型、真实听觉验收、远端矩阵或付费 PR 审阅。
