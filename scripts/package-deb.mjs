import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

/**
 * A .deb for Debian and Ubuntu, built from the folder `pnpm package:linux` leaves in dist/linux/Anna.
 * Installs to /opt/Anna with an `anna` command, a menu entry and an icon. Being installed as root, it can keep
 * Chromium's sandbox the usual way: a setuid chrome-sandbox, plus an AppArmor profile on Ubuntu 23.10+.
 * The file name has no version, so https://github.com/…/releases/latest/download/Anna-linux-amd64.deb always works.
 */
const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch]

const desktop = `[Desktop Entry]
Name=Anna
Comment=A digital life on your desktop, and an honest companion
Exec=/opt/Anna/anna %U
Icon=anna
Type=Application
Terminal=false
Categories=Development;Utility;
MimeType=x-scheme-handler/anna;
StartupWMClass=Anna
`

// Written by postinst only where AppArmor 4 is present (Ubuntu 23.10+), which is where user namespaces are restricted.
// scripts/linux-launcher.sh looks for a profile naming the binary in /etc/apparmor.d/anna-*.
const postinst = `#!/bin/sh
set -e
if [ "$1" = configure ]; then
  if [ -f /opt/Anna/chrome-sandbox ]; then
    chown root:root /opt/Anna/chrome-sandbox
    chmod 4755 /opt/Anna/chrome-sandbox
  fi
  if [ -f /etc/apparmor.d/abi/4.0 ]; then
    cat > /etc/apparmor.d/anna-deb <<'PROFILE'
# Lets Anna (installed from the .deb) create the user namespaces Chromium's sandbox needs.
abi <abi/4.0>,
include <tunables/global>

profile anna-deb "/opt/Anna/anna-bin" flags=(unconfined) {
  userns,

  include if exists <local/anna-deb>
}
PROFILE
    if command -v apparmor_parser >/dev/null 2>&1; then
      apparmor_parser -r /etc/apparmor.d/anna-deb || rm -f /etc/apparmor.d/anna-deb
    fi
  fi
fi
exit 0
`

const postrm = `#!/bin/sh
set -e
if [ "$1" = remove ] || [ "$1" = purge ]; then
  if [ -f /etc/apparmor.d/anna-deb ]; then
    if command -v apparmor_parser >/dev/null 2>&1; then apparmor_parser -R /etc/apparmor.d/anna-deb >/dev/null 2>&1 || true; fi
    rm -f /etc/apparmor.d/anna-deb
  fi
fi
exit 0
`

async function main() {
  if (process.platform !== 'linux' || !arch)
    throw new Error('Build the .deb on Linux (x64 or arm64)')
  const source = resolve('dist/linux/Anna')
  if (!existsSync(join(source, 'anna-bin')))
    throw new Error('Run pnpm package:linux first: dist/linux/Anna/anna-bin is missing')
  const { version } = JSON.parse(await readFile('package.json', 'utf8'))
  const root = resolve('.data/deb-root')
  await rm(root, { recursive: true, force: true })
  await mkdir(join(root, 'opt'), { recursive: true })
  await cp(source, join(root, 'opt/Anna'), { recursive: true, verbatimSymlinks: true })
  await mkdir(join(root, 'usr/bin'), { recursive: true })
  await symlink('/opt/Anna/anna', join(root, 'usr/bin/anna'))
  await mkdir(join(root, 'usr/share/applications'), { recursive: true })
  await writeFile(join(root, 'usr/share/applications/anna.desktop'), desktop)
  await mkdir(join(root, 'usr/share/icons/hicolor/512x512/apps'), { recursive: true })
  await cp(resolve('assets/favicon.png'), join(root, 'usr/share/icons/hicolor/512x512/apps/anna.png'))
  // Installed-Size is in KiB; the last line of `du -c` is the total.
  const size = Number.parseInt(execFileSync('du', ['-sck', join(root, 'opt'), join(root, 'usr')]).toString().trim().split('\n').at(-1), 10)
  await mkdir(join(root, 'DEBIAN'), { recursive: true })
  await writeFile(join(root, 'DEBIAN/control'), [
    'Package: anna',
    `Version: ${version}`,
    'Section: utils',
    'Priority: optional',
    `Architecture: ${arch}`,
    `Installed-Size: ${size}`,
    'Maintainer: Anna contributors <https://github.com/YuanyuanMa03/anna>',
    'Homepage: https://anna.mayuanyuan.top',
    'Depends: libgtk-3-0 | libgtk-3-0t64, libnss3, libasound2 | libasound2t64, libsecret-1-0, libnotify4, xdg-utils',
    // Anna runs terminal commands in a bubblewrap sandbox, which needs these.
    'Recommends: bubblewrap, socat, ripgrep',
    'Description: A digital life on your desktop, and an honest companion',
    ' Anna is a Live2D companion who chats with you and gets real work done:',
    ' reading code, editing files and running tests, with Claude Code-style',
    ' permission modes and a system sandbox.',
    '',
  ].join('\n'))
  for (const [name, text] of [['postinst', postinst], ['postrm', postrm]]) {
    await writeFile(join(root, 'DEBIAN', name), text)
    await chmod(join(root, 'DEBIAN', name), 0o755)
  }
  const output = resolve(`dist/linux/Anna-linux-${arch}.deb`)
  execFileSync('dpkg-deb', ['--root-owner-group', '-Zxz', '--build', root, output], { stdio: 'inherit' })
  execFileSync('dpkg-deb', ['--info', output], { stdio: 'inherit' })
  process.stdout.write(`${output}\n`)
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
