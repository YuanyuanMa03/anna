---
title: Anna · 有面容、有记忆的 AI 伙伴
emoji: 🌸
colorFrom: pink
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
license: other
---

# Anna 在线体验

Anna 是有面容、个性和记忆的 AI 伙伴。本体验基于 [YuanyuanMa03/anna](https://github.com/YuanyuanMa03/anna) 的 pi Agent 核心与 Live2D 界面，增加浏览器通信与独立访客工作区。

可体验：真实模型对话、五位伙伴切换、朗读（依赖浏览器语音）、可查看和删除的记忆、工作区文件读写与改动展示。

在线版不提供：终端执行、访问访客电脑文件、微信、Claude Code / Codex 派活、全局服务商切换。代码运行和测试结果只有实际执行才成立，在线版不会模拟成功。

## 模型与会话

- 仅连接 ModelScope 免费推理，默认模型 `Qwen/Qwen3.5-35B-A3B`。
- 如服务端未配置可用免费额度，在“模型与设置”中选择自定义 / OpenAI Chat Completions，地址 `https://api-inference.modelscope.cn/v1`，填入自己的 ModelScope Token。
- Key 只保留在服务端会话内存，不写入工作区、代码或 Git。勿在对话中填写密码或其他敏感信息。
- 每个浏览器标签页有独立会话。刷新可继续当前会话；关闭标签页会失去入口。闲置 2 小时后数据清理；容器重启会丢失体验数据。
- 本体验使用免费 CPU 与外部免费推理，无本地 GPU。模型额度、限流和可用性以 ModelScope 账号实际返回为准。

## 来源与许可

Anna 代码采用 PolyForm Noncommercial 1.0.0，见 LICENSE 和 COMMERCIAL.md。Live2D 样例素材与 Cubism Core 保留各自许可，见 `dist/web/licenses/` 与 NOTICE.md。

部署产物来自 GitHub 默认分支的独立适配分支，源提交与验证记录见 `DEPLOYMENT.md`。示例工作区 README 为手工构造的演示输入，不是实测或科研证据。
