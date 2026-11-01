import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import electron from 'electron'

/** Portable Linux build: a directory with the `anna` launcher and the `anna-bin` Electron binary, packed as tar.gz. Sandbox needs bubblewrap, socat and ripgrep. */
async function main() {
  if (process.platform !== 'linux')
    throw new Error('Build the Linux package on Linux')
  const output = resolve('dist/linux')
  const app = join(output, 'Anna')
  const runtime = join(app, 'resources/app')
  const pnpm = args => execFileSync('pnpm', args, { stdio: 'inherit' })
  pnpm(['build'])
  await mkdir(output, { recursive: true })
  await rm(app, { recursive: true, force: true })
  await cp(dirname(electron), app, { recursive: true, verbatimSymlinks: true })
  await rm(join(app, 'resources/default_app.asar'), { force: true })
  pnpm(['--filter', 'anna', 'deploy', '--legacy', '--prod', '--ignore-scripts', '--frozen-lockfile', runtime])
  for (const entry of await readdir(runtime)) {
    if (entry !== 'node_modules')
      await rm(join(runtime, entry), { recursive: true, force: true })
  }
  // `anna` is a launcher that keeps Chromium's sandbox when the system allows it (see scripts/linux-launcher.sh).
  await rename(join(app, 'electron'), join(app, 'anna-bin'))
  await cp(resolve('scripts/linux-launcher.sh'), join(app, 'anna'))
  await chmod(join(app, 'anna'), 0o755)
  for (const path of ['dist/host', 'dist/renderer', 'plugins/anna-persona/persona.md', 'LICENSE', 'NOTICE.md']) {
    await mkdir(dirname(join(runtime, path)), { recursive: true })
    await cp(resolve(path), join(runtime, path), { recursive: true })
  }
  const original = JSON.parse(await readFile('package.json', 'utf8'))
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: 'anna', productName: 'Anna', version: original.version, type: 'module', main: 'dist/host/apps/desktop/main.js', dependencies: original.dependencies }, null, 2))
  const archive = `Anna-${original.version}-linux-${process.arch}.tar.gz`
  execFileSync('tar', ['-czf', join(output, archive), '-C', output, 'Anna'], { stdio: 'inherit' })
  const digest = createHash('sha256').update(await readFile(join(output, archive))).digest('hex')
  await writeFile(join(output, `${archive}.sha256`), `${digest}  ${archive}\n`)
  await writeFile(join(output, 'package-report.json'), JSON.stringify({ platform: process.platform, arch: process.arch, version: original.version, executable: 'Anna/anna', sandboxDependencies: ['bubblewrap', 'socat', 'ripgrep'] }, null, 2))
  process.stdout.write(`${join(output, archive)}\n`)
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
