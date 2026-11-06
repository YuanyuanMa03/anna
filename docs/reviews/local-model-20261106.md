# A model on this computer — 2026-11-06

Branch `codex/local-model`, stacked on #59.

## Why

The Intel local-AI track requires at least one inference operator or model layer to run on the contest machine's own GPU or NPU, with an effect on the final output (checked in Task Manager's Performance tab). Until now pi only accepted HTTPS endpoints, so a model served on the same machine could not be her brain.

## Change

- **Plain HTTP on this machine only.** A model endpoint may be plain HTTP when it is on this computer (`127.0.0.1`, `localhost`, `[::1]`). Everything else must still be HTTPS without credentials or a query (`modelEndpointAllowed` and `isLocalEndpoint` in `packages/shared/model-vendors.ts`, used by `validateModel` and the model list).
- **A 本机模型 tile.** It has presets for Ollama (`:11434/v1`), LM Studio (`:1234/v1`), llama.cpp (`:8080/v1`) and OpenVINO Model Server (`:8000/v3`), and an editable address. It needs no key, and fetches the local server's models as soon as it is picked.
- **No key for a local server.** `configure` stores the placeholder `local`; a saved cloud key is never sent to it.
- **A visible label.** With pi on a local model, the status line reads `<model> · 本机模型`.
- **Test timeout.** `vitest.config.ts` raises the per-test timeout from 5 s to 20 s. Process-spawning tests (git fixtures, the push hook, fake agents) kept hitting 5 s on a loaded machine (load average 27) and pass alone. A real hang still fails.

## Verification (macOS arm64)

- Tests first:
  - loopback HTTP accepted and LAN or remote HTTP refused;
  - the local tile;
  - a keyless list;
  - a host test showing that a keyless local setup with a cloud key saved first failed (the changed-address guard fired before the keyless rule), and passes after reordering.
- `tests/onboarding.mjs` checks the tile: no key field, the address presets, the list (`artifacts/onboarding-local-model.png`).
- `pnpm preflight`: 984 passed, 19 skipped. `pnpm build` and `pnpm test:scripted` pass.

## Not verified

- **A real local server:** none was called. Whether the owner's Qwen3.5-9B runtime on Windows runs on the Intel GPU/NPU depends on that runtime and its settings, not on Anna. Anna only sends the requests.
- **Small local models:** pi's system prompt and tools are large. A local runtime with a small default context (Ollama's num_ctx, for example) may truncate them, and a 9B model may use tools poorly. pi registers custom models with a 131,072-token context.
