# Anna Host

The Host owns settings, credential storage access, one runtime, and product events.
`SettingsStore` serializes atomic writes. Electron supplies the system credential vault.

Desktop Main constructs one Host per data directory.
Renderer consumers use `packages/shared` contracts. They cannot construct this Node module.
