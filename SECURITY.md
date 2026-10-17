# Security policy

Anna runs an AI agent with shell and file access on your machine, so security reports are taken seriously.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through
[GitHub private vulnerability reporting](https://github.com/YuanyuanMa03/anna/security/advisories/new).
Include steps to reproduce and the version you tested. You'll get an answer within a few days.

## In scope

- Bypassing a permission mode, a deny rule or a sensitive-path block, for example through path tricks, symlinks or
  command flags.
- Escaping the command sandbox, or reaching the network without approval.
- Reading credentials from the vault, `providers.bin`, or another agent's config.
- Making a delegated agent act outside the mode Anna mapped it to.
- Tampering with the installers or the updater: checksum or HTTPS bypass.

## Known limits (not vulnerabilities)

These are documented in [docs/permissions.md](docs/permissions.md#known-limits):

- pi's file tools are guarded by the policy engine, not the OS sandbox.
- Windows has no command sandbox yet.
- Undo doesn't cover changes made by shell commands.
