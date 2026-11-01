#!/bin/zsh
set -e
cd "${0:A:h}"
if [[ ! -f dist/host/apps/desktop/main.js || ! -f dist/renderer/anna-room/anna.moc3 ]]; then
  pnpm build
fi
# Uses Anna's existing data and settings through its unchanged main/core entry points.
ANNA_ROOT="$PWD" node node_modules/electron/cli.js dist/host/apps/desktop/main.js
