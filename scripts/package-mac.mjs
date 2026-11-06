import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, readlink, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import electron from 'electron'
import { stageSearchTools } from './search-tools.mjs'
import { stageRuntime } from './stage-runtime.mjs'

/** Stage the production dependency closure and a complete Electron application. No user data enters the bundle. */
async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('This package target requires macOS Apple Silicon')
  const root = process.cwd()
  const output = resolve('dist/macos')
  const app = join(output, 'Anna.app')
  const icon = resolve('.data/Anna.iconset')
  execFileSync('pnpm', ['build'], { stdio: 'inherit' })
  await mkdir(output, { recursive: true })
  await rm(app, { recursive: true, force: true })
  execFileSync('/usr/bin/ditto', [resolve(dirname(electron), '../..'), app])
  const resources = join(app, 'Contents/Resources')
  await rm(join(resources, 'default_app.asar'), { force: true })
  const original = JSON.parse(await readFile('package.json', 'utf8'))
  const runtimeReport = await stageRuntime(root, resources)
  // Signed below with the rest of the bundle's Mach-O files.
  const searchTools = await stageSearchTools(resources, 'darwin', { arch: 'arm64' })
  await rm(icon, { recursive: true, force: true })
  execFileSync('/usr/bin/swift', [join(root, 'scripts/make-icon.swift'), icon])
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', icon, '-o', join(resources, 'anna.icns')])
  execFileSync('/usr/bin/python3', ['-c', `
import plistlib,sys
from pathlib import Path
app=Path(sys.argv[1]); version=sys.argv[2]
p=app/'Contents/Info.plist'; d=plistlib.loads(p.read_bytes())
d.update(CFBundleDisplayName='Anna',CFBundleName='Anna',CFBundleIdentifier='com.yuanyuanma.anna',CFBundleExecutable='Anna',CFBundleIconFile='anna.icns',CFBundleShortVersionString=version,CFBundleVersion=version,LSApplicationCategoryType='public.app-category.lifestyle',NSHumanReadableCopyright='Copyright © 2026 YuanyuanMa03',CFBundleURLTypes=[{'CFBundleURLName':'Anna import link','CFBundleURLSchemes':['anna']}])
for k in list(d):
 if k.endswith('UsageDescription') or k=='ElectronAsarIntegrity':d.pop(k)
d.update(NSMicrophoneUsageDescription='仅在你开启录音时供 Anna 通过所选本地服务或云端 API 识别语音。')
p.write_bytes(plistlib.dumps(d))
(app/'Contents/MacOS/Electron').rename(app/'Contents/MacOS/Anna')
for p in (app/'Contents/Frameworks').glob('*.app/Contents/Info.plist'):
 d=plistlib.loads(p.read_bytes()); old=p.parent.parent.stem; name=old.replace('Electron','Anna'); suffix=d['CFBundleIdentifier'].removeprefix('com.github.Electron')
 d.update(CFBundleExecutable=name,CFBundleName=name,CFBundleDisplayName=name,CFBundleIdentifier='com.yuanyuanma.anna'+suffix)
 p.write_bytes(plistlib.dumps(d)); (p.parent/'MacOS'/old).rename(p.parent/'MacOS'/name); p.parent.parent.rename(p.parent.parent.with_name(name+'.app'))
`, app, original.version])
  let links = 0
  async function verifyLinks(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const target = await realpath(path)
        if (relative(app, target).startsWith('..'))
          throw new Error(`Bundle symlink escapes the application: ${await readlink(path)}`)
        links++
      }
      else if (entry.isDirectory()) {
        await verifyLinks(path)
      }
    }
  }
  await verifyLinks(app)
  const signing = JSON.parse(execFileSync('/usr/bin/python3', [join(root, 'scripts/sign-local.py'), app]).toString())
  // No static check covers the Mac bundle: running them after signing proves they are present, arm64 and launchable.
  for (const tool of searchTools)
    execFileSync(join(resources, 'bin', tool), ['--version'], { stdio: 'ignore', timeout: 30_000 })
  // The zip is what install.sh and the in-app updater download (curl/Node add no quarantine flag).
  const zip = join(output, `Anna-${original.version}-mac-${process.arch}.zip`)
  await rm(zip, { force: true })
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip])
  const digest = createHash('sha256').update(await readFile(zip)).digest('hex')
  await writeFile(`${zip}.sha256`, `${digest}  ${basename(zip)}\n`)
  const report = { app, zip, sha256: digest, version: original.version, arch: process.arch, electron: '44.7.0', runtime: 'pi', signing: signing.signing, certificate: signing.certificate, notarized: false, containedSymlinks: links, searchTools, ...runtimeReport }
  await writeFile(join(output, 'package-report.json'), JSON.stringify(report, null, 2))
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
