import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import electron from 'electron'
import { runPnpm } from './run-pnpm.mjs'
import { stageRuntime } from './stage-runtime.mjs'

async function main() {
  if (process.platform !== 'win32')
    throw new Error('Build the Windows package on Windows')
  const output = resolve('dist/windows')
  const app = join(output, 'Anna')
  runPnpm(['build'])
  await mkdir(output, { recursive: true })
  await rm(app, { recursive: true, force: true })
  await cp(dirname(electron), app, { recursive: true })
  await rm(join(app, 'resources/default_app.asar'), { force: true })
  await rename(join(app, 'electron.exe'), join(app, 'Anna.exe'))
  const original = JSON.parse(await readFile('package.json', 'utf8'))
  const runtimeReport = await stageRuntime(process.cwd(), join(app, 'resources'))
  const zip = `Anna-${original.version}-windows-${process.arch}.zip`
  // The system's own tar writes zip; the one Git Bash puts first on PATH does not.
  execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-h', '-cf', join(output, zip), '-C', output, 'Anna'], { stdio: 'inherit' })
  const digest = createHash('sha256').update(await readFile(join(output, zip))).digest('hex')
  await writeFile(join(output, `${zip}.sha256`), `${digest}  ${zip}\n`)
  await writeFile(join(output, 'package-report.json'), JSON.stringify({ platform: process.platform, arch: process.arch, version: original.version, executable: 'Anna/Anna.exe', signed: false, ...runtimeReport }, null, 2))
  process.stdout.write(`${join(output, zip)}\n`)
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
