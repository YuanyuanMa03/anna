# Anna desktop

- `main.ts`: the Electron main process. Windows, menus, notifications, the OS keychain vault and the updater. It starts
  the core process and restarts it if it crashes.
- `core.ts`: the core `utilityProcess`, which runs the Host, kernels, sandbox and WeChat channel.
- `preload.ts`: a sandboxed preload exposing the fixed Anna bridge.
- `src/`: the Vue renderer, with the Live2D stage, director, cards and sheets.

From the repository root, run `pnpm dev:desktop`.
