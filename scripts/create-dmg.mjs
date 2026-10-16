import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

async function main() {
  const app = resolve('dist/macos/Anna.app')
  const stage = resolve('.data/dmg-root')
  const version = JSON.parse(await readFile('package.json', 'utf8')).version
  const output = resolve(`dist/macos/Anna-${version}-arm64.dmg`)
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  await rm(stage, { recursive: true, force: true })
  await mkdir(stage, { recursive: true })
  await cp(app, resolve(stage, 'Anna.app'), { recursive: true, verbatimSymlinks: true })
  await symlink('/Applications', resolve(stage, 'Applications'))
  execFileSync('/usr/bin/hdiutil', ['create', '-volname', `Anna ${version}`, '-srcfolder', stage, '-ov', '-format', 'UDZO', output], { stdio: 'inherit' })
  execFileSync('/usr/bin/hdiutil', ['verify', output], { stdio: 'inherit' })
  process.stdout.write(`${output}\n`)
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
