import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import electron from 'electron'
import { runPnpm } from './run-pnpm.mjs'
import { stageRuntime } from './stage-runtime.mjs'

/** Portable Linux build: a directory with the `anna` launcher and the `anna-bin` Electron binary, packed as tar.gz. Sandbox needs bubblewrap, socat and ripgrep. */
async function main() {
  if (process.platform !== 'linux')
    throw new Error('Build the Linux package on Linux')
  const output = resolve('dist/linux')
  const app = join(output, 'Anna')
  runPnpm(['build'])
  await mkdir(output, { recursive: true })
  await rm(app, { recursive: true, force: true })
  await cp(dirname(electron), app, { recursive: true, verbatimSymlinks: true })
  await rm(join(app, 'resources/default_app.asar'), { force: true })
  await rename(join(app, 'electron'), join(app, 'anna-bin'))
  await cp(resolve('scripts/linux-launcher.sh'), join(app, 'anna'))
  await chmod(join(app, 'anna'), 0o755)
  const original = JSON.parse(await readFile('package.json', 'utf8'))
  const runtimeReport = await stageRuntime(process.cwd(), join(app, 'resources'))
  const archive = `Anna-${original.version}-linux-${process.arch}.tar.gz`
  execFileSync('tar', ['-czf', join(output, archive), '-C', output, 'Anna'], { stdio: 'inherit' })
  const digest = createHash('sha256').update(await readFile(join(output, archive))).digest('hex')
  await writeFile(join(output, `${archive}.sha256`), `${digest}  ${archive}\n`)
  await writeFile(join(output, 'package-report.json'), JSON.stringify({ platform: process.platform, arch: process.arch, version: original.version, executable: 'Anna/anna', sandboxDependencies: ['bubblewrap', 'socat', 'ripgrep'], ...runtimeReport }, null, 2))
  process.stdout.write(`${join(output, archive)}\n`)
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
