# Notices

Required Notice: Copyright (c) 2026 YuanyuanMa03 (https://github.com/YuanyuanMa03/anna)

Anna's code is licensed under the PolyForm Noncommercial License 1.0.0 (see `LICENSE`); commercial use needs a license
from the author (see `COMMERCIAL.md`). Anna v0.4.1 and earlier were released under the MIT license, and those releases
keep it.

Anna retains selected Project AIRI rendering patterns under MIT. Original copyright: 2024-PRESENT Neko Ayaka.
The original license is in `assets/licenses/AIRI-MIT.txt`.

The renderer uses AIRI's Pixi 6 and pixi-live2d-display foundation. The Vue stage owns the canvas, ticker, model, resize observer, and disposal.
This project does not copy the AIRI monorepo or its agent runtime.

Hiyori, Haru Greeter, Mark, Niziiro Mao, Natori Jin and Chitose are Live2D sample assets. Anna's license does not cover them.
The companions' names, personalities and lines in `packages/character/manifest.ts` are Anna's own writing; the characters' designs belong to Live2D Inc.
Their models, textures, motions, previews, and Cubism Core are not tracked in Git. `pnpm assets` downloads them from
this repository's `assets-v1` and `assets-v2` releases and verifies each file against `docs/asset-inventory.json`.
Their original ReadMe files and the Cubism Core license are in `assets/licenses/`.
If you redistribute Anna or build on it, review the Live2D Free Material License and the Cubism SDK terms yourself;
a custom model is the safest choice for commercial use.

Sources:

- https://www.live2d.com/zh-CHS/learn/sample/momose-hiyori/
- https://www.live2d.com/zh-CHS/learn/sample/haru-receptionist/
- https://www.live2d.com/zh-CHS/learn/sample/mark/
- https://www.live2d.com/zh-CHS/learn/sample/niziiro-mao/
- https://www.live2d.com/zh-CHS/learn/sample/natori-jin/
- https://www.live2d.com/zh-CHS/learn/sample/chitose/
- https://www.live2d.com/learn/sample/model-terms/
- https://www.live2d.com/eula/live2d-free-material-license-agreement_jp.html

System speech uses macOS voices through Chromium. No voice data is part of this repository.
The agent kernel is pi (`@earendil-works/pi-*`). Shell commands are isolated with Anthropic's `@anthropic-ai/sandbox-runtime` (Apache-2.0).
The Weixin channel follows the protocol of Tencent's openclaw-weixin (MIT); its license is in `assets/licenses/Tencent-Weixin-MIT.txt`.
Agent detection and provider presets follow cc-switch (https://github.com/farion1231/cc-switch, MIT, © Jason Young). `packages/agents/presets.json` is generated from its preset files by `scripts/sync-ccswitch-presets.mjs`; referral parameters are removed. The Codex model catalog (`packages/agents/codex-catalog.ts`) is ported from its `codex_config.rs`, and `packages/agents/codex-catalog/*.json` are copied from its bundled templates (`deepseek.json` is DeepSeek's official Codex catalog as cc-switch ships it).
Electron, Node.js, pi, sandbox-runtime, and other dependencies retain their upstream licenses.
