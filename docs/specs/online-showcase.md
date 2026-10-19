# Showing what makes Anna Anna (memory, routing, delegation) in the online demo

## Why

A judge's walk through the ModelScope demo on 2026-10-19 (the exact Studio build, run locally with real models)
found every task working. But Anna read as "a Live2D chat agent that can fix bugs", which describes AIRI too. What
sets Anna apart was there but hidden, or broken:

- The opening suggestions and Anna's self-introduction lead with coding ("读文件、写代码……完成编码任务").
- **Memory claimed but not kept.** On "记住：我每周三下午有实验课" the pi brain (Qwen3.5-35B) answered "好的，我记住了" without
  calling `anna_memory`; nothing was stored. When the tool is called, it works (a Claude Code brain then reads it).
- **No provenance.** Memory items don't say who wrote them, so after a companion switch Chitose said "我刚才记下来的" about
  something Anna wrote, and a Claude Code brain could only say it doesn't know who wrote it. The persona promises the
  opposite ("提到这些内容时如实说出处").
- In the online demo Anna offers WeChat tasks (desktop only), and volunteers the server's workspace path and her
  Live2D sample model's name. Approval cards show a 100-character server path.
- On a phone (390 px) the top buttons wrap into vertical text, the activity and delivery cards cover the character
  and the reply bubble sits on the notice text.
- Local routing (Claude Code and Codex running on ModelScope Qwen through Anna's routing), memory that survives a
  brain switch and delegation with review are all live in the demo, but nothing points a visitor at them. WeChat
  ClawBot and cc-switch provider switching are desktop only and aren't mentioned.

## Core (main; ships in the desktop app too)

1. **Memory records who wrote it.** A memory item carries `by`, the companion who was on stage (with the brain when
   it isn't pi, e.g. "Anna（Claude Code）"). The shared diary in the instructions lists each line with its writer
   ("（Anna 记下）"); items from before this change say "（没记录是谁记的）". The memory list in the UI shows the writer.
2. **"记住：…" is kept for sure.** A user message that starts with 记住 / 请记住 / 帮我记住 followed by a separator and
   content is stored by the host before the turn, attributed to the companion on stage, and the turn's instructions
   say it is already stored (so the brain neither stores it twice nor claims something else). Questions such as
   "记住了吗？" are not stored. Credentials are refused as the tool refuses them.
3. **Edition notes.** `HostOptions.notes` adds a section to the instructions. The online demo uses it to say what this
   edition lacks (WeChat, choosing folders, own providers) and not to volunteer paths or sample model names.

## Online demo (deploy/modelscope-full)

4. **A tour instead of coding suggestions.** Before the first message the stage offers prompts that show Anna's
   strengths: delegation with review on a daily task ("@claude 把这周的复习安排排进 plan.md"), shared memory across
   companions and brains ("记住：我每周三下午有实验课"), and a bug fix as one item, not the lead. A short line says
   that Claude Code and Codex here run on ModelScope Qwen through Anna's local routing.
5. **"桌面版还能做" card**: WeChat ClawBot remote tasks, cc-switch provider presets and switching, global routing for
   the agents' own CLIs, each one line, linking to the website. No claim that any of them works online.
6. **Short workspace paths in the UI.** In the online demo the visitor's absolute workspace path is shown as
   `workspace` in approval cards, activity rows and replies; the command that runs is unchanged.
7. **Phone layout.** At 600 px and below the top bar scrolls sideways instead of wrapping, the cards sit below the
   character instead of over it, and the bubble never overlaps the notice. No horizontal page scroll.

## Test seams

- `MemoryStore` (remember with a writer, `instructions()`, the `anna_memory` tool): items 1 and 2's storage.
- `Host.execute({ type: 'send' })` with a fake kernel factory that records the instructions it gets: items 1–3.
- A pure renderer module for the online demo (`apps/desktop/src/online.ts`): the tour prompts and `shortPaths()`:
  item 6.
- Items 4, 5 and 7 are checked in a real browser at 1366 px and 390 px (screenshots), not by unit tests.

## Out of scope

WeChat or cc-switch working in the browser; a different default model; the in-app updater.

## Deadline

Deployed to the Studio and verified with `ANNA_SELF_TEST` before 2026-10-21 23:59 (Beijing); no changes during the
preliminary review (2026-10-22 to 24).
