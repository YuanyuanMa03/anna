import { execFileSync } from 'node:child_process'
import { chmod, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { electronDist, sha256 } from './electron-dist.mjs'
import { runPnpm } from './run-pnpm.mjs'
import { stageSearchTools } from './search-tools.mjs'
import { stageRuntime } from './stage-runtime.mjs'

/** Portable Linux build: a directory with the `anna` launcher and the `anna-bin` Electron binary, packed as tar.gz. Sandbox needs bubblewrap and socat; ripgrep ships in resources/bin. */
async function main() {
  if (process.platform === 'win32')
    throw new Error('Build the Linux package on macOS or Linux: Windows cannot keep its executable bits')
  const output = resolve('dist/linux')
  const app = join(output, 'Anna')
  runPnpm(['build'])
  await mkdir(output, { recursive: true })
  await rm(app, { recursive: true, force: true })
  await cp(await electronDist('linux', 'x64'), app, { recursive: true, verbatimSymlinks: true })
  await rm(join(app, 'resources/default_app.asar'), { force: true })
  await rename(join(app, 'electron'), join(app, 'anna-bin'))
  await cp(resolve('scripts/linux-launcher.sh'), join(app, 'anna'))
  await chmod(join(app, 'anna'), 0o755)
  const original = JSON.parse(await readFile('package.json', 'utf8'))
  const runtimeReport = await stageRuntime(process.cwd(), join(app, 'resources'))
  const searchTools = await stageSearchTools(join(app, 'resources'), 'linux', { arch: 'x64' })
  const archive = `Anna-${original.version}-linux-x64.tar.gz`
  // Built on a Mac: no AppleDouble files, extended attributes or the builder's user name in what people unpack.
  const owner = process.platform === 'darwin' ? ['--no-xattrs', '--no-mac-metadata', '--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root'] : ['--owner=0', '--group=0']
  execFileSync('tar', [...owner, '-czf', join(output, archive), '-C', output, 'Anna'], { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } })
  const digest = await sha256(join(output, archive))
  await writeFile(join(output, `${archive}.sha256`), `${digest}  ${archive}\n`)
  await writeFile(join(output, 'package-report.json'), JSON.stringify({ platform: 'linux', arch: 'x64', version: original.version, executable: 'Anna/anna', sandboxDependencies: ['bubblewrap', 'socat'], searchTools, ...runtimeReport }, null, 2))
  process.stdout.write(`${join(output, archive)}\n`)
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
