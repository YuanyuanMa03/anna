# Notices

Required Notice: Copyright (c) 2026 YuanyuanMa03 (https://github.com/YuanyuanMa03/anna)

Anna's code is licensed under the PolyForm Noncommercial License 1.0.0 (see `LICENSE`); commercial use needs a license
from the author (see `COMMERCIAL.md`). Anna v0.4.1 and earlier were released under the MIT license, and those releases
keep it.

Anna retains selected Project AIRI rendering patterns under MIT. Original copyright: 2024-PRESENT Neko Ayaka.
The original license is in `assets/licenses/AIRI-MIT.txt`.

The renderer uses AIRI's Pixi 6 and pixi-live2d-display foundation. The Vue stage owns the canvas, ticker, model, resize observer, and disposal.
This project does not copy the AIRI monorepo or its agent runtime.

Anna's own body is drawn by the mesh-avatar runtime (https://github.com/shinshin86/mesh-avatar-studio, MIT, © 2026 Yuki Shindo)
from an archive built with Mesh Avatar Studio from her original art. The archive (`assets/anna-body/`) and the art
(`artwork/anna-body/`) are part of this repository and under its license. The art was generated with AI tools.

Haru Greeter (Anna's anime form) is a Live2D sample asset. Anna's license does not cover it.
Anna's name, personality and lines in `packages/character/manifest.ts` are this project's own writing; the character's design belongs to Live2D Inc.
The model, textures, motions, previews, and Cubism Core are not tracked in Git. `pnpm assets` downloads them from
this repository's `assets-v1` release and verifies each file against `docs/asset-inventory.json`.
The original ReadMe and the Cubism Core license are in `assets/licenses/`.
If you redistribute Anna or build on it, review the Live2D Free Material License and the Cubism SDK terms yourself;
a custom model is the safest choice for commercial use.

Sources:

- https://www.live2d.com/zh-CHS/learn/sample/haru-receptionist/
- https://www.live2d.com/learn/sample/model-terms/
- https://www.live2d.com/eula/live2d-free-material-license-agreement_jp.html

System speech uses macOS voices through Chromium. No voice data is part of this repository.
The agent kernel is pi (`@earendil-works/pi-*`). Shell commands are isolated with Anthropic's `@anthropic-ai/sandbox-runtime` (Apache-2.0).
The Weixin channel follows the protocol of Tencent's openclaw-weixin (MIT); its license is in `assets/licenses/Tencent-Weixin-MIT.txt`.
Agent detection and provider presets follow cc-switch (https://github.com/farion1231/cc-switch, MIT, © Jason Young); the config locations and install commands of Kimi Code, Oh My Pi, DeepSeek Harness and Antigravity CLI come from its `*_config.rs` and `misc.rs`. The other recognised local agents and how they speak ACP come from the Agent Client Protocol registry (https://github.com/agentclientprotocol/registry). `packages/agents/presets.json` is generated from cc-switch's preset files by `scripts/sync-ccswitch-presets.mjs`; referral parameters are removed. The Codex model catalog (`packages/agents/codex-catalog.ts`) is ported from cc-switch's `codex_config.rs`, and `packages/agents/codex-catalog/*.json` are copied from its bundled templates (`deepseek.json` is DeepSeek's official Codex catalog as cc-switch ships it). The balance and quota lookups (`packages/agents/usage.ts`), the speed test, universal providers and the import-link format follow cc-switch's implementation and documentation.
Electron, Node.js, pi, sandbox-runtime, and other dependencies retain their upstream licenses.
