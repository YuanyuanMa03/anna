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

Anna 是住在你桌面上的数字伙伴：有自己的样子、性格和记忆，会陪你聊天，也会认真帮你做事。这里是完整的 Anna，代码来自 [YuanyuanMa03/anna](https://github.com/YuanyuanMa03/anna)，只是把桌面窗口换成了浏览器。

## 可以体验

- **五位 Live2D 伙伴**：Anna、Mao、名执尽、千岁、马克君，共用一本关于你的日记（长期记忆，可查看、可删除）。
- **真正动手**：读文件、改代码、在沙箱里跑终端命令和测试。每个任务结束都有交付卡，可以看 diff、一键撤销。
- **四种权限模式**：规划、谨慎、协作、放手。越权的操作会弹出审批卡，由你决定。
- **派活**：输入 `@codex …` 或 `@claude …`，把活交给 Codex 或 Claude Code，Anna 会检查它们的改动再告诉你能不能放心用。也可以在“模型与设置”里把 Anna 的大脑换成它们。
- **示例项目**：每位访客的工作区里有一个带 bug 的小项目，可以直接说“跑一下测试，看看哪里坏了，然后修好它”。

## 隔离与模型

- 每位访客有独立的 Anna 进程和独立的 Linux 用户，工作区、记忆、会话互不可见；闲置 2 小时后整个会话清理。容器重启会丢失体验数据。
- Anna 自己运行的终端命令在 bubblewrap 沙箱里，只能写自己的工作区和临时目录，联网要你批准。
- 派给 Claude Code、Codex 的活（以及把大脑换成它们时）不在这个沙箱里：它们以你这位访客自己的 Linux 用户运行，可以联网；它们同样读不到别的访客的文件和服务端的密钥。
- 模型来自 ModelScope 免费推理（Anna 用 Qwen3.5-35B-A3B，Claude Code / Codex 用更大的 Qwen 模型；某个模型额度用完会自动换下一个）。密钥只在服务端，你和你运行的任何程序都读不到。
- 免费 CPU 和免费推理有额度和速度限制，高峰期回复可能较慢。请勿输入密码等敏感信息。
- 微信远程派活、自定义服务商和选择本机文件夹需要桌面版。

## 来源与许可

Anna 代码采用 PolyForm Noncommercial 1.0.0，见 LICENSE 和 COMMERCIAL.md。Live2D 样例素材与 Cubism Core 保留各自许可，见 `dist/web/licenses/` 与 NOTICE.md。Codex（Apache-2.0）和 Claude Code 在构建镜像时从 npm 安装，遵循各自的条款。

源提交与构建方式见 `DEPLOYMENT.md`。示例项目是手工构造的演示代码，不是真实数据。
