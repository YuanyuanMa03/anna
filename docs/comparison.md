# Anna among her peers

**English** · [简体中文](comparison.zh-CN.md)

Anna sits where three kinds of projects meet: AI companions that live on your screen, desktop pets that watch your
coding agents, and desktop shells that drive coding agents for you. Each of them does part of what Anna does, and
several do that part better. This page says plainly where Anna stands, where she falls short, and whom she learned from.

Star counts are from GitHub on 2026-10-20 and will drift. Anna herself had one.

## The neighbours

### AI companions: a soul on the screen, rarely at work

| Project | Stars | What it is |
|---|---:|---|
| [Project AIRI](https://github.com/moeru-ai/airi) | 50.5k | Re-creating Neuro-sama: Live2D and VRM, voice, games, every platform. The benchmark for a character. |
| [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) | 14.2k | Hands-free voice chat with interruption and a Live2D avatar, fully local if you like. |
| [Super Agent Party](https://github.com/heshengtao/super-agent-party) | 2.7k | A companion that does everything: VRM, computer control, MCP and skills, group chats, IM bots, live streaming. |
| [my-neuro](https://github.com/morettt/my-neuro) | 1.4k | A trainable voice and persona, long-term memory, MCP, games and live streaming. |

They are far ahead on voice, streaming and play. None of them is a coding agent you would trust in a repository: no
permission modes, no sandbox, no diff to read, nothing to undo.

### Pets that watch your coding agents

| Project | Stars | What it is |
|---|---:|---|
| [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk) | 6.5k | A pixel crab that reacts to 20+ coding agents in real time, with approval bubbles, a session dashboard and approvals from Telegram or Feishu. |
| [OpenPets](https://github.com/OpenPetsHQ/openpets) | 1.3k | A desktop pet platform with a sandboxed plugin SDK; coding-agent reactions are one optional layer. |

These are Anna's closest neighbours, and Clawd on Desk shares almost all of her audience. The difference is who does
the work: a pet watches another agent and relays its prompts; Anna is the agent, and when she hands a job to Claude
Code or Codex, she takes the result back and checks it before she tells you it is done.

### Desktop shells for coding agents

| Project | Stars | What it is |
|---|---:|---|
| [cc-switch](https://github.com/farion1231/cc-switch) | 146k | The provider switcher for Claude Code, Codex and friends. Anna's provider pages come from it. |
| [Claude Code Router](https://github.com/musistudio/claude-code-router) | 37.8k | Local routing across models and providers. |
| [AionUi](https://github.com/iOfficeAI/AionUi) | 33.6k | One desktop app for 20+ CLI agents. |
| [opcode](https://github.com/winfunc/opcode) | 22.4k | A GUI and toolkit for Claude Code sessions and custom agents. |
| [CodePilot](https://github.com/op7418/CodePilot) | 6.5k | A multi-model agent client with MCP, skills and phone control. |
| [Crystal](https://github.com/stravu/crystal) | 3.1k | Parallel Claude Code and Codex sessions, each in its own git worktree. |

They are more complete as tools, and they are tools: panels, not someone.

## Where Anna is strong

- **She is one person across every brain.** Her face, her heart and the shared diary stay the same whether pi,
  Claude Code or Codex is thinking. Switch companions or brains and the conversation carries on.
- **She does the work herself, and supervises when she doesn't.** Delegated jobs come back to her; she reads the
  changes, runs the quick tests, and tells you whether to rely on them.
- **Safety you can see.** Four permission modes in Claude Code's format, a real OS sandbox on macOS and Linux, a
  snapshot before every task, and a delivery card with the diff and one-click undo, including for other agents' work.
- **Honesty as a rule, not a mood.** No invented tool results; a test she did not run is a test she says she did not
  run. Memory says who wrote each line, and companions do not take credit for each other's words.
- **Providers and routing built in.** cc-switch's presets, local format conversion for Chat Completions providers,
  backups with failover and a circuit breaker, and global routing for the agents you run in a terminal.

## Where Anna falls short

- **Her voice is borrowed.** She speaks through the system's speech synthesis, cannot hear you, has no voice of her
  own, and her mouth only approximates the words. The companion projects above are well ahead here.
- **Fewer agents.** Claude Code and Codex are verified on real machines; Gemini CLI, OpenCode and Pi follow their
  protocols but are unverified. Clawd on Desk tracks more than twenty.
- **No command sandbox on Windows yet.**
- **The interface speaks Chinese only.** An English UI and persona are on the roadmap.
- **No worktree per task.** Delegated jobs share the workspace; Crystal shows how it should be done.
- **The cast are Live2D samples.** Anna does not yet have a model drawn for her.
- **A noncommercial license.** PolyForm Noncommercial keeps Anna free for people, and also makes her harder to adopt
  inside companies than the MIT, Apache or AGPL projects above.
- **One maintainer.** Most of the projects above have a community behind them.

## What she learned, and from whom

- **[OpenClaw](https://github.com/openclaw/openclaw)** carried the first prototype of Anna.
- **DeepSeek Harness** moved her into an Electron desktop with real Live2D characters (v0.2).
- **[pi](https://github.com/earendil-works/pi)** is the brain she was rebuilt on when she had to finish real coding tasks (v0.3).
- **[Claude Code](https://github.com/anthropics/claude-code)** gave her the permission model: the modes, the rule
  format and matching, Shift+Tab, and the idea that rules remember exceptions while the sandbox is the real boundary.
- **[sandbox-runtime](https://github.com/anthropics/sandbox-runtime)** is that sandbox.
- **[cc-switch](https://github.com/farion1231/cc-switch)** taught her to find the agents already on your machine, and
  lent her its provider presets and import link format.
- **[Project AIRI](https://github.com/moeru-ai/airi)** showed how to render Live2D on the web stack she uses, and is the
  standard she measures a character against.
- **[openclaw-weixin](https://github.com/Tencent/openclaw-weixin)** opened the door to WeChat.
- **Live2D's free samples** are the faces of the cast, under Live2D's own terms (see [NOTICE.md](../NOTICE.md)).

Things worth borrowing next: Clawd on Desk's approvals from a phone and its overview of every live session, and
Crystal's worktree per task.
