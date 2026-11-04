# Anna Gateway 融合方案审阅

2026-11-04；仅文档，未实现或启动服务。

## 范围与证据

- 核对 `apps/desktop/core.ts`、`packages/routing/server.ts`、`packages/character/manifest.ts`、`pnpm-workspace.yaml`、LICENSE 和现有独立网关设计。
- 原本机路由固定 localhost、拒绝 Origin；方案明确新建对外网关边界，不直接放宽原路由。
- 原仓库 workspace 未枚举 packages；建议目录说明为共享源码，不假称已存在独立包。
- 新建 `docs/specs/anna-gateway.md`；同步独立目录设计中关于仓库归属、LLM 与连接方式的冲突。完整变更只涉及上述设计文档和本记录。

## 审阅结论

未发现阻止本轮设计记录落地的问题。方案把模型运行、网关运行、外部 API、管理权、Anna 文件/记忆权限分别定义；当前 Mac mini 本地 LLM 仍关闭。无生产配置、凭据、用户数据或监听变更。

## 尚待实施验证

- New API 手动加额失败、设备密钥/账本迁移、并发结算尚未验证；不得称完整计费闭环已交付。
- 网关后端分发前需核对上游与 Anna 许可，独立进程不自动解决该问题。
- 独立启动、桌面生命周期、局域网/HTTPS 真跨设备、三平台 Git 部署与 Intel 比赛机均为后续验收。
- 文档改动执行 whitespace 与内容一致性检查；未运行推理、安装器或原有会调用 LLM 的验收脚本。无运行时代码变更，不为本轮运行应用测试。
