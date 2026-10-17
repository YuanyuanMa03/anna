import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, readlink, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import electron from 'electron'

/** Stage the production dependency closure and a complete Electron application. No user data enters the bundle. */
async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('This package target requires macOS Apple Silicon')
  const root = process.cwd()
  const output = resolve('dist/macos')
  const app = join(output, 'Anna.app')
  const stage = resolve('.data/macos-stage')
  const icon = resolve('.data/Anna.iconset')
  execFileSync('pnpm', ['build'], { stdio: 'inherit' })
  await mkdir(output, { recursive: true })
  await rm(stage, { recursive: true, force: true })
  execFileSync('pnpm', ['--filter', 'anna', 'deploy', '--legacy', '--prod', '--ignore-scripts', '--frozen-lockfile', '--offline', stage], { stdio: 'inherit' })
  await rm(app, { recursive: true, force: true })
  execFileSync('/usr/bin/ditto', [resolve(dirname(electron), '../..'), app])
  const resources = join(app, 'Contents/Resources')
  await rm(join(resources, 'default_app.asar'), { force: true })
  const runtime = join(resources, 'app')
  await mkdir(runtime, { recursive: true })
  await cp(join(stage, 'node_modules'), join(runtime, 'node_modules'), { recursive: true, verbatimSymlinks: true })
  for (const path of ['dist/host', 'dist/renderer', 'plugins/anna-persona/persona.md', 'LICENSE', 'NOTICE.md']) {
    await mkdir(dirname(join(runtime, path)), { recursive: true })
    await cp(join(root, path), join(runtime, path), { recursive: true })
  }
  const original = JSON.parse(await readFile('package.json', 'utf8'))
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: 'anna', productName: 'Anna', version: original.version, private: true, type: 'module', main: 'dist/host/apps/desktop/main.js', dependencies: original.dependencies }, null, 2))
  await rm(icon, { recursive: true, force: true })
  execFileSync('/usr/bin/swift', [join(root, 'scripts/make-icon.swift'), icon])
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', icon, '-o', join(resources, 'anna.icns')])
  execFileSync('/usr/bin/python3', ['-c', `
import plistlib,sys
from pathlib import Path
app=Path(sys.argv[1]); version=sys.argv[2]
p=app/'Contents/Info.plist'; d=plistlib.loads(p.read_bytes())
d.update(CFBundleDisplayName='Anna',CFBundleName='Anna',CFBundleIdentifier='com.yuanyuanma.anna',CFBundleExecutable='Anna',CFBundleIconFile='anna.icns',CFBundleShortVersionString=version,CFBundleVersion=version,LSApplicationCategoryType='public.app-category.lifestyle',NSHumanReadableCopyright='Copyright © 2026 Anna contributors')
for k in list(d):
 if k.endswith('UsageDescription') or k=='ElectronAsarIntegrity':d.pop(k)
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
  // The zip is what install.sh and the in-app updater download (curl/Node add no quarantine flag).
  const zip = join(output, `Anna-${original.version}-mac-${process.arch}.zip`)
  await rm(zip, { force: true })
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip])
  const digest = createHash('sha256').update(await readFile(zip)).digest('hex')
  await writeFile(`${zip}.sha256`, `${digest}  ${basename(zip)}\n`)
  const report = { app, zip, sha256: digest, version: original.version, arch: process.arch, electron: '44.7.0', runtime: 'pi', signing: signing.signing, certificate: signing.certificate, notarized: false, containedSymlinks: links }
  await writeFile(join(output, 'package-report.json'), JSON.stringify(report, null, 2))
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
