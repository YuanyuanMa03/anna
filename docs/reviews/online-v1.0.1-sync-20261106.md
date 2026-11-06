# Sync review: the online line catches up with v1.0.1 (2026-11-06)

Scope: bring the ModelScope Studio demo and the website up to the released desktop v1.0.1
(tag `v1.0.1` → 4811b42). No desktop runtime changes.

## Online demo (branch `release/online-v1.0.1`, Studio `mayy101184/anna`)

Merge `main` (73 commits ahead) into `release/online-v0.6.0` (16 online-only commits).
Six conflicted files; resolution keeps main's desktop behaviour and re-applies the online
adaptation on top:

| File | Resolution |
| --- | --- |
| `apps/desktop/index.html` | Keep the online CSP (`script-src 'self'`, no wasm/frame relaxations): the web edition has no local models or gateway iframe, so main's loosenings are not needed online. |
| `package.json` | Union: main's extended `test:scripted`/`preflight`/`hooks:install` + the branch's `build:web`/`start:web`. |
| `tsconfig.json` | main's include + `apps/web/**`. |
| `packages/anna-host/settings.ts` | main's `modelEndpointAllowed()`; verified it admits the server's loopback relay (`http://127.0.0.1:7870/v1`) via `isLocalEndpoint`. |
| `apps/desktop/src/app.vue` | main as the base; re-applied: `web` flag (declared before `suggestions` uses it), tour card, quota notice, WeChat guard (auto-merged), starter prompts → `tourPrompts()`, `Anna 档案` chip disabled on web, talk button hidden on web (no local ASR/TTS endpoints server-side), AvatarMaker `can-ask` guard (auto-merged). Dropped the stale `propsColumn` ref (main removed its script side). |
| `apps/desktop/src/style.css` | Both sides kept (additive blocks). |

Extra adaptation beyond conflicts: `apps/web/bridge.ts` gains a `voice()` that answers
`{ ok: false, error: '在线体验暂不支持语音…' }` — `AnnaBridge` grew a required `voice`
member on main, and refusing keeps any stray call from hanging. `apps/web/commands.ts`
needed no change: its allow-list rejects main's new commands (`share-pi-model`,
`connection-test`, …) with the desktop-only message.

Onboarding does not appear online: `seedVisitor` writes `modelVerified: true`, and main's
migration turns that into `onboardingComplete: true` (verified in the smoke snapshot).

### Verification

- `pnpm typecheck`, `pnpm lint`: pass.
- `pnpm test`: 1031 passed / 19 skipped — includes the web server, web guard and online
  suites running the real server.
- Local smoke of the packaged artifact (`artifacts/modelscope`): index 200, `/api/session`
  issues a token, `snapshot` through a real visitor core process returns
  `onboardingComplete: true`, kernel `pi`, model → relay.
- Studio deploy (image tag `…-648a25ec-…`, matching pushed commit 648a25e): build log
  SUCCESS, run log `Anna web listening on port 7860 (per-visitor users)`, status Running.
- Live acceptance through a real browser session (Electron, software WebGL): the v1.0.1
  UI renders (`Anna 档案 ▾`), the tour card and 〈工作区〉 short paths appear, the model
  reports connected (`Qwen/Qwen3.5-35B-A3B` via the loopback relay), and a real visitor
  message got a real model reply (“1+1 等于 2。交付 耗时 1.7 秒”). Console errors: only
  the platform iframe's feature-permission warnings.

Known differences from desktop, by design: no WeChat, no brain switching, no onboarding,
no voice; the settings sheet shows the "already wired to ModelScope" note and hides the
desktop-only sections.

## Website (branch `codex/body-calm`, 404cecd)

- `website/src/copy.ts`: the features intro claimed the roadmap batch "arrives with the
  next in-app update"; v1.0.1 shipped it, so zh/en now say it is in the stable line.
- Media re-captured with `scripts/website-media.mjs` from the release build: the previous
  captures (Nov 6 19:48) predate the three body-calm fixes (8be2293, da228a3, 4811b42,
  20:12–20:45) that changed her body, mouth and gaze. One frame reviewed: natural pose,
  v1.0.1 chrome visible, no rendering artifacts.
- `website/public/latest.json` refreshed from the published v1.0.1 release and signed with
  `scripts/sign-manifest.mjs` (gitignored, deployed only). Deployed via
  `pnpm deploy:website` (Worker version f4fb5785); verified live: new copy in the bundle,
  `latest.json` → 1.0.1 + signature, all media 200.

## Remaining risks / not verified

- The Studio demo's agent delegation (@claude/@codex through the relay) was not exercised
  live this round; the relay itself answered the pi brain. The fallback chain also untested.
- The Studio edition's free-quota exhaustion path (`quota-notice`) only triggers when the
  shared daily quota actually runs out.
- `release/online-v1.0.1` is pushed as a new remote branch; `release/online-v0.6.0` is left
  untouched as the rollback source.
