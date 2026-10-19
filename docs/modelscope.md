# ModelScope browser deployment

The browser build reuses Anna's Vue/Live2D renderer, `Host`, pi kernel, permission broker, checkpoints and memory. Electron continues using its existing IPC. The web build uses a per-tab random session capability and streamed events over HTTP, with no third-party cookie dependency.

## Local run

```sh
pnpm install --frozen-lockfile
pnpm assets
pnpm build:web
pnpm start:web
```

Open http://127.0.0.1:7860. The model is unconfigured unless `ANNA_MODEL_API_KEY` is supplied to the server. The only supported online provider is the ModelScope free inference endpoint. Visitors can enter their own ModelScope key when the server has no key. Keys stay in server memory, never workspace files or the renderer response.

## Deploy

```sh
pnpm build:web
node scripts/package-modelscope.mjs
```

The output is `artifacts/modelscope/`. It includes a production dependency lockfile, the compiled renderer and server, original licenses and deployment provenance. Publish this directory to a ModelScope Docker Studio's `master` branch; use a credential helper, never a token in the remote URL. Use `platform/2v-cpu-8g-mem` only if the current hardware API reports it as free. Port is `7860`. Keep the root repository's private history and local settings out of the Studio.

Optional secrets: `ANNA_MODEL_API_KEY`. Variables: `ANNA_MODEL` (default `Qwen/Qwen3.5-35B-A3B`), `ANNA_MAX_SESSIONS` (default 30), `ANNA_WEB_DATA` (default `/tmp/anna-web-sessions`). This deployment intentionally uses disposable demo sessions, not persistent personal storage.

## Boundaries and validation

- Per visitor: Host, model key, session, memory, workspace, provider config directories and event stream.
- Tool allowlist: workspace `read/write/edit/grep/find/ls`, `anna_memory`, `anna_status`. No shell, external agents, workspace reassignment, provider routing or Weixin.
- Canonical path checks cover symlinks and pi path spellings; the original permission gate still handles mode and approval.
- HTTP commands are allowlisted; model endpoints are fixed to ModelScope, preventing requests to arbitrary internal services.
- A visitor session allows at most 8 messages/minute, three event streams, 100 KB writes and 12,000-character messages; sessions expire after 2 idle hours. These limits are demonstration controls, not an internet-scale tenancy system.
- Test inputs are synthetic and labeled. Unit/integration results demonstrate implementation behavior only. Real model, public URL and browser acceptance must be recorded separately.

The online version cannot run code/tests, access the visitor's computer or supervise installed Claude Code/Codex. It must not claim those capabilities. Browser speech relies on local speech synthesis availability.
