# Anna Desktop

Electron Main owns the Host. A sandboxed Preload exposes the fixed Anna Bridge.
Vue renders the stage, character cards, conversation, plugin sheet, and model settings.

From the repository root, run `pnpm dev:desktop`.
Use this app for the local desktop Demo. Renderer code accesses product commands through the Bridge.
Runtime and credential operations belong to the Host packages.
