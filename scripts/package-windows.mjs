import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { electronDist, sha256, zipFolder } from './electron-dist.mjs'
import { runPnpm } from './run-pnpm.mjs'
import { stageSearchTools } from './search-tools.mjs'
import { longestPath, stageRuntime } from './stage-runtime.mjs'

async function main() {
  const output = resolve('dist/windows')
  const app = join(output, 'Anna')
  runPnpm(['build'])
  await mkdir(output, { recursive: true })
  await rm(app, { recursive: true, force: true })
  await cp(await electronDist('win32', 'x64'), app, { recursive: true })
  await rm(join(app, 'resources/default_app.asar'), { force: true })
  await rename(join(app, 'electron.exe'), join(app, 'Anna.exe'))
  const original = JSON.parse(await readFile('package.json', 'utf8'))
  const runtimeReport = await stageRuntime(process.cwd(), join(app, 'resources'))
  const searchTools = await stageSearchTools(join(app, 'resources'), 'win32', { arch: 'x64' })
  // With the install folder in front, this leaves room for long user names below Windows' 260 characters.
  const longest = await longestPath(app)
  if (longest > 190)
    throw new Error(`A packaged path is ${longest} characters long; Windows tools fail near 260`)
  const zip = `Anna-${original.version}-windows-x64.zip`
  await rm(join(output, zip), { force: true })
  zipFolder(output, 'Anna', join(output, zip))
  const digest = await sha256(join(output, zip))
  await writeFile(join(output, `${zip}.sha256`), `${digest}  ${zip}\n`)
  await writeFile(join(output, 'package-report.json'), JSON.stringify({ platform: 'win32', arch: 'x64', version: original.version, executable: 'Anna/Anna.exe', signed: false, searchTools, ...runtimeReport }, null, 2))
  process.stdout.write(`${join(output, zip)}\n`)
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
