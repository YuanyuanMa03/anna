import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

/**
 * Wrap the folder from `pnpm package:windows` in a setup wizard (scripts/windows-installer.nsi), for people who
 * would rather double-click than paste a PowerShell command. Needs NSIS 3 (makensis). The file name has no version,
 * so https://github.com/…/releases/latest/download/Anna-Setup-windows-x64.exe always works.
 */
function makensis() {
  const candidates = [process.env.MAKENSIS, 'C:\\Program Files (x86)\\NSIS\\makensis.exe', 'C:\\Program Files\\NSIS\\makensis.exe'].filter(Boolean)
  return candidates.find(path => existsSync(path)) ?? 'makensis'
}

async function main() {
  const source = resolve('dist/windows/Anna')
  if (!existsSync(join(source, 'Anna.exe')))
    throw new Error('Run pnpm package:windows first: dist/windows/Anna/Anna.exe is missing')
  const { version } = JSON.parse(await readFile('package.json', 'utf8'))
  const output = resolve(`dist/windows/Anna-Setup-windows-${process.arch}.exe`)
  execFileSync(makensis(), ['-V2', `-DVERSION=${version}`, `-DSOURCE=${source}`, `-DOUTFILE=${output}`, resolve('scripts/windows-installer.nsi')], { stdio: 'inherit' })
  process.stdout.write(`${output}\n`)
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
