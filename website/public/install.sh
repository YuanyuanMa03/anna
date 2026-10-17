#!/usr/bin/env bash
# Anna installer for macOS and Linux.
#   curl -fsSL https://anna.mayuanyuan.top/install.sh | bash
# Files downloaded with curl carry no quarantine flag, so Gatekeeper does not block the (unnotarized) app.
# Every download is checked against the SHA-256 published in latest.json before anything is installed.
set -euo pipefail

BASE="${ANNA_RELEASE_BASE:-https://anna.mayuanyuan.top}"
fail() { echo "Anna install failed: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }
need curl

case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux) OS=linux ;;
  *) fail "unsupported system $(uname -s). On Windows, run in PowerShell: irm https://anna.mayuanyuan.top/install.ps1 | iex" ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=x64 ;;
  *) fail "unsupported CPU architecture $(uname -m)" ;;
esac
KEY="$OS-$ARCH"

fetch() {
  case "$1" in
    https://*) curl -fsSL --proto '=https' --tlsv1.2 "$1" -o "$2" ;;
    file://*) [ "${ANNA_INSTALL_ALLOW_FILE:-}" = 1 ] || fail "only HTTPS downloads are allowed"; curl -fsSL "$1" -o "$2" ;;
    *) fail "download URL must be HTTPS: $1" ;;
  esac
}

WORK="$(mktemp -d)"
# Keep the real exit status: a cleanup trap must not turn a failure into success.
trap 'status=$?; rm -rf "$WORK"; exit $status' EXIT
fetch "$BASE/latest.json" "$WORK/latest.json" || fail "could not fetch release info from $BASE/latest.json"

# latest.json lists one asset per line: "darwin-arm64": { "url": "…", "sha256": "…" }
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$WORK/latest.json" | head -1)"
LINE="$(grep "\"$KEY\"" "$WORK/latest.json" || true)"
[ -n "$LINE" ] || fail "version $VERSION has no package for $KEY yet"
URL="$(printf '%s' "$LINE" | sed -n 's/.*"url": *"\([^"]*\)".*/\1/p')"
SHA="$(printf '%s' "$LINE" | sed -n 's/.*"sha256": *"\([0-9a-fA-F]\{64\}\)".*/\1/p')"
[ -n "$URL" ] && [ -n "$SHA" ] || fail "release info is malformed"

echo "Downloading Anna $VERSION ($KEY)..."
ARCHIVE="$WORK/anna-archive"
fetch "$URL" "$ARCHIVE" || fail "download failed: $URL"
if command -v shasum >/dev/null 2>&1; then ACTUAL="$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1)"; else ACTUAL="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"; fi
[ "$(printf '%s' "$ACTUAL" | tr 'A-F' 'a-f')" = "$(printf '%s' "$SHA" | tr 'A-F' 'a-f')" ] || fail "checksum mismatch: the download does not match the published release, nothing was installed"

if [ "$OS" = darwin ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST" "$WORK/unpacked"
  /usr/bin/ditto -x -k "$ARCHIVE" "$WORK/unpacked"
  [ -d "$WORK/unpacked/Anna.app" ] || fail "the package does not contain Anna.app"
  # Quit a running copy before replacing it.
  pkill -x Anna >/dev/null 2>&1 || true
  rm -rf "$DEST/Anna.app"
  mv "$WORK/unpacked/Anna.app" "$DEST/Anna.app"
  /usr/bin/xattr -dr com.apple.quarantine "$DEST/Anna.app" >/dev/null 2>&1 || true
  echo "Anna $VERSION installed to $DEST/Anna.app"
  [ "${ANNA_INSTALL_NO_OPEN:-}" = 1 ] || open "$DEST/Anna.app"
else
  DEST="${XDG_DATA_HOME:-$HOME/.local/share}/anna-app"
  BIN="$HOME/.local/bin"
  mkdir -p "$WORK/unpacked" "$BIN" "${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  tar -xzf "$ARCHIVE" -C "$WORK/unpacked"
  [ -x "$WORK/unpacked/Anna/anna" ] || fail "the package does not contain Anna/anna"
  pkill -x anna >/dev/null 2>&1 || true
  rm -rf "$DEST"
  mv "$WORK/unpacked/Anna" "$DEST"
  ln -sf "$DEST/anna" "$BIN/anna"
  cat > "${XDG_DATA_HOME:-$HOME/.local/share}/applications/anna.desktop" <<DESKTOP
[Desktop Entry]
Name=Anna
Comment=A digital companion that gets work done
Exec=$DEST/anna
Icon=$DEST/resources/app/dist/renderer/favicon.png
Type=Application
Categories=Development;Utility;
DESKTOP
  echo "Anna $VERSION installed to $DEST (command: anna)"
  missing=""
  for dep in bwrap socat rg; do command -v "$dep" >/dev/null 2>&1 || missing="$missing $dep"; done
  [ -z "$missing" ] || echo "Note: missing$missing. Install bubblewrap, socat and ripgrep so Anna can run commands in its sandbox."
fi
