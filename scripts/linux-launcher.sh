#!/bin/sh
# Anna launcher for Linux, shipped as Anna/anna next to the Electron binary Anna/anna-bin.
# Chromium's sandbox needs unprivileged user namespaces, or a root-owned setuid chrome-sandbox. Ubuntu 23.10+ blocks
# those namespaces through AppArmor unless a profile allows them for the program, and Chromium then refuses to start.
# Keep the sandbox whenever the system allows it; otherwise start without it instead of crashing, and say how to fix it.
here="$(dirname "$(readlink -f "$0")")"
bin="$here/anna-bin"

sandbox_available() {
  # A setuid-root chrome-sandbox works without user namespaces.
  if [ -u "$here/chrome-sandbox" ] && [ "$(stat -c %u "$here/chrome-sandbox" 2>/dev/null)" = 0 ]; then return 0; fi
  # An AppArmor profile for this binary, as install.sh writes with ANNA_INSTALL_APPARMOR=1.
  if grep -qsF "\"$bin\"" "${ANNA_APPARMOR_DIR:-/etc/apparmor.d}"/anna-*; then return 0; fi
  # Without unshare there is nothing to test with: let Chromium decide.
  command -v unshare >/dev/null 2>&1 || return 0
  unshare --user --map-root-user true >/dev/null 2>&1
}

if sandbox_available; then
  exec "$bin" "$@"
fi
echo "Anna: this system blocks the user namespaces Chromium's sandbox needs, so Anna starts without it." >&2
echo "Anna: to keep the sandbox, rerun the installer with ANNA_INSTALL_APPARMOR=1 (adds an AppArmor profile with sudo)." >&2
exec "$bin" --no-sandbox "$@"
