# Shared contracts

Settings, snapshots, commands and events used by every process, plus a few small runtime pieces:

- `rpc.ts`: the RPC peer between main and core;
- `vault.ts`: the vault wrapper around the OS keychain;
- `update.ts`: release manifest and update planning;
- `platform.ts`: data directory per platform.

Nothing here holds pi objects or credential values.
