import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

/**
 * The macOS installer for people who don't use a terminal: Anna.app next to an Applications shortcut, plus a note on
 * the first launch. A browser download is quarantined and Anna isn't notarized, so macOS asks once in Privacy & Security.
 * The file name has no version, so https://github.com/…/releases/latest/download/Anna-mac-arm64.dmg always works.
 */
const firstLaunch = `打开 Anna · Opening Anna
========================

1. 把 Anna 拖进“应用程序”文件夹。
2. 在“应用程序”里双击 Anna。
3. 如果 macOS 提示“无法验证 Anna”，点“完成”，然后打开
   系统设置 → 隐私与安全性，在页面底部点“仍要打开”，再确认一次。

只有第一次需要这样做。Anna 是开源软件，作者没有付费的 Apple 开发者账号，
所以没有经过公证；每个版本都用同一个自签名身份签名，之后在应用内更新。

1. Drag Anna into the Applications folder.
2. Double-click Anna in Applications.
3. If macOS says it could not verify Anna, click Done, then open
   System Settings → Privacy & Security and click "Open Anyway" near the bottom.

You only need to do this once. Anna is open source and not notarized (no paid
Apple developer account); every release carries the same self-signed identity,
and later updates happen inside the app.
`

async function main() {
  const app = resolve('dist/macos/Anna.app')
  const stage = resolve('.data/dmg-root')
  const version = JSON.parse(await readFile('package.json', 'utf8')).version
  const output = resolve('dist/macos/Anna-mac-arm64.dmg')
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  await rm(stage, { recursive: true, force: true })
  await mkdir(stage, { recursive: true })
  await cp(app, resolve(stage, 'Anna.app'), { recursive: true, verbatimSymlinks: true })
  await symlink('/Applications', resolve(stage, 'Applications'))
  await writeFile(resolve(stage, '打开前请读 · Read me.txt'), firstLaunch)
  // LZMA: half the size of the default zlib image; it needs macOS 10.15, below what Electron supports anyway.
  execFileSync('/usr/bin/hdiutil', ['create', '-volname', `Anna ${version}`, '-srcfolder', stage, '-ov', '-format', 'ULMO', output], { stdio: 'inherit' })
  execFileSync('/usr/bin/hdiutil', ['verify', output], { stdio: 'inherit' })
  process.stdout.write(`${output}\n`)
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
