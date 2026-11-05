import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import electron from 'electron'
import { longestPath, pruneRuntime, runtimeDeployFlags } from './package-runtime.mjs'

async function main() {
  if (process.platform !== 'win32')
    throw new Error('Build the Windows package on Windows')
  const output = resolve('dist/windows')
  const app = join(output, 'Anna')
  const runtime = join(app, 'resources/app')
  const pnpm = args => execFileSync('pnpm.cmd', args.map(arg => /\s/.test(arg) ? `"${arg}"` : arg), { stdio: 'inherit', shell: true })
  pnpm(['build'])
  await mkdir(output, { recursive: true })
  await rm(app, { recursive: true, force: true })
  await cp(dirname(electron), app, { recursive: true })
  await rm(join(app, 'resources/default_app.asar'), { force: true })
  pnpm(['--filter', 'anna', 'deploy', '--legacy', '--prod', '--ignore-scripts', '--frozen-lockfile', ...runtimeDeployFlags, runtime])
  await pruneRuntime(join(runtime, 'node_modules'))
  for (const entry of await readdir(runtime)) {
    if (entry !== 'node_modules')
      await rm(join(runtime, entry), { recursive: true, force: true })
  }
  await rename(join(app, 'electron.exe'), join(app, 'Anna.exe'))
  for (const path of ['dist/host', 'dist/renderer', 'plugins/anna-persona/persona.md', 'LICENSE', 'NOTICE.md']) {
    await mkdir(dirname(join(runtime, path)), { recursive: true })
    await cp(resolve(path), join(runtime, path), { recursive: true })
  }
  // With the install folder in front, this leaves room for long user names below Windows' 260 characters.
  const longest = await longestPath(app)
  if (longest > 190)
    throw new Error(`A packaged path is ${longest} characters long; Windows tools fail near 260`)
  const original = JSON.parse(await readFile('package.json', 'utf8'))
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: 'anna', productName: 'Anna', version: original.version, type: 'module', main: 'dist/host/apps/desktop/main.js', dependencies: original.dependencies }, null, 2))
  const zip = `Anna-${original.version}-windows-${process.arch}.zip`
  // The system's own tar writes zip; the one Git Bash puts first on PATH does not.
  execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-h', '-cf', join(output, zip), '-C', output, 'Anna'], { stdio: 'inherit' })
  const digest = createHash('sha256').update(await readFile(join(output, zip))).digest('hex')
  await writeFile(join(output, `${zip}.sha256`), `${digest}  ${zip}\n`)
  await writeFile(join(output, 'package-report.json'), JSON.stringify({ platform: process.platform, arch: process.arch, version: original.version, executable: 'Anna/Anna.exe', signed: false }, null, 2))
  process.stdout.write(`${join(output, zip)}\n`)
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
