import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, posix, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { extractFile, getRawHeader, listPackage, statFile } from '@electron/asar'
import { longestPath } from './stage-runtime.mjs'

const peMachines = { 0x8664: 'x64', 0xAA64: 'arm64' }
const elfMachines = { 62: 'x64', 183: 'arm64' }

/** What an executable was built for, from its own header, so nothing is taken on trust from a file name. */
export function binaryKind(bytes) {
  if (bytes.length > 0x40 && bytes.toString('latin1', 0, 2) === 'MZ') {
    const header = bytes.readUInt32LE(0x3C)
    if (header + 6 <= bytes.length && bytes.toString('latin1', header, header + 4) === 'PE\0\0')
      return `windows-${peMachines[bytes.readUInt16LE(header + 4)] ?? 'other'}`
  }
  if (bytes.length > 20 && bytes.toString('latin1', 0, 4) === '\x7FELF')
    return `linux-${elfMachines[bytes.readUInt16LE(18)] ?? 'other'}`
  return 'unknown'
}

const targets = {
  win32: { executable: 'Anna.exe', kind: 'windows-x64', extras: ['resources/anna.ico'], absent: ['electron.exe'], native: 'win32-x64', runnable: [], tools: ['resources/bin/rg.exe', 'resources/bin/fd.exe'] },
  linux: { executable: 'anna-bin', kind: 'linux-x64', extras: ['anna', 'chrome-sandbox', 'resources/favicon.png'], absent: ['electron'], native: 'linux-x64', runnable: ['anna', 'anna-bin', 'chrome-sandbox', 'chrome_crashpad_handler', 'resources/bin/rg', 'resources/bin/fd'], tools: ['resources/bin/rg', 'resources/bin/fd'] },
}

/** Asar stores names with the native separator, while these checks reason in `/`. */
const member = file => file.replace(/^\//, '').split('/').join(sep)

/** Every dependency a shipped package declares must be found the way Node would look for it, or it fails at run time. */
function missingDependencies(archive, files) {
  const present = new Set(files)
  const problems = []
  for (const file of files) {
    if (!/\/node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(file))
      continue
    const folder = posix.dirname(file)
    const manifest = JSON.parse(extractFile(archive, member(file)).toString())
    const peers = Object.keys(manifest.peerDependencies ?? {}).filter(name => !manifest.peerDependenciesMeta?.[name]?.optional)
    for (const name of [...Object.keys(manifest.dependencies ?? {}), ...peers]) {
      let found = false
      for (let at = folder; !found; at = posix.dirname(at)) {
        found = present.has(posix.join(at, 'node_modules', name, 'package.json'))
        if (at === '/')
          break
      }
      // Beside the archive is where the sandbox runtime and what it needs stay on real files.
      if (!found && !existsSync(join(dirname(archive), 'node_modules', name, 'package.json')) && name !== 'electron')
        problems.push(`${manifest.name} needs ${name}, which is not in the package`)
    }
  }
  return problems
}

/** The sandbox runtime and what it needs stay on real files beside the archive: the same rule applies to them. */
async function missingBesideArchive(modules) {
  if (!existsSync(modules))
    return []
  const problems = []
  for (const entry of await readdir(modules, { withFileTypes: true, recursive: true })) {
    if (entry.name !== 'package.json' || !/[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+$/.test(entry.parentPath))
      continue
    const manifest = JSON.parse(await readFile(join(entry.parentPath, 'package.json'), 'utf8'))
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      let found = false
      for (let at = entry.parentPath; !found; at = dirname(at)) {
        found = existsSync(join(at, 'node_modules', name, 'package.json'))
        if (at === dirname(modules))
          break
      }
      if (!found)
        problems.push(`${manifest.name} needs ${name}, which is not beside the archive`)
    }
  }
  return problems
}

/** What can be proved about a package without running it on its own system. */
export async function checkPackage(platform, app, version) {
  const target = targets[platform]
  const problems = []
  const executable = join(app, target.executable)
  if (!existsSync(executable)) {
    problems.push(`${target.executable} is missing`)
  }
  else {
    const kind = binaryKind(await readFile(executable))
    if (kind !== target.kind)
      problems.push(`${target.executable} is ${kind}, not ${target.kind}`)
  }
  for (const extra of target.extras) {
    if (!existsSync(join(app, extra)))
      problems.push(`${extra} is missing`)
  }
  // Without them the agent's grep and find download from GitHub on first use, which fails offline.
  for (const tool of target.tools) {
    const path = join(app, ...tool.split('/'))
    if (!existsSync(path)) {
      problems.push(`${join(...tool.split('/'))} is missing`)
      continue
    }
    const kind = binaryKind(await readFile(path))
    if (kind !== target.kind)
      problems.push(`${join(...tool.split('/'))} is ${kind}, not ${target.kind}`)
  }
  for (const stale of [...target.absent, 'resources/app', 'resources/default_app.asar']) {
    if (existsSync(join(app, stale)))
      problems.push(`${join(...stale.split('/'))} must not ship: Electron would prefer it or it is unused`)
  }
  const archive = join(app, 'resources/app.asar')
  const files = existsSync(archive) ? listPackage(archive, { isPack: false }).map(file => file.replaceAll('\\', '/')) : []
  if (!files.length) {
    problems.push('resources/app.asar is missing or empty')
    return { problems, stats: {} }
  }
  const manifest = JSON.parse(extractFile(archive, 'package.json').toString())
  if (manifest.version !== version)
    problems.push(`The app says version ${manifest.version}, expected ${version}`)
  for (const required of [manifest.main, 'dist/host/apps/desktop/main.js', 'dist/host/apps/desktop/core.js', 'dist/renderer/index.html']) {
    if (!files.includes(`/${required}`))
      problems.push(`${required} is not in the archive`)
  }
  if (files.some(file => file.endsWith('/.DS_Store')))
    problems.push('The archive contains .DS_Store files')
  if (getRawHeader(archive).headerString.includes('"link":'))
    problems.push('The archive contains links')
  problems.push(...missingDependencies(archive, files))
  const entries = await readdir(app, { withFileTypes: true, recursive: true })
  const installed = entries.filter(entry => entry.isFile())
  problems.push(...await missingBesideArchive(join(app, 'resources/node_modules')))
  const longest = await longestPath(app)
  if (longest > 190)
    problems.push(`A path is ${longest} characters long`)
  if (installed.length > 2000)
    problems.push(`${installed.length} files to unpack: the package has grown out of its single archive`)
  for (const file of target.runnable) {
    try { accessSync(join(app, ...file.split('/')), constants.X_OK) }
    catch { problems.push(`${join(...file.split('/'))} is not executable`) }
  }
  const links = entries.filter(entry => entry.isSymbolicLink())
  if (links.length)
    problems.push(`${links.length} links in the package`)
  // A package without her would still start and pass the smoke test.
  if (!files.includes('/dist/renderer/live2dcubismcore.min.js') || !files.some(file => file.endsWith('.model3.json')))
    problems.push('Her character assets are not in the archive')
  const natives = files.filter(file => /\.(?:node|dll|so|dylib|exe)$/.test(file))
  for (const file of natives) {
    if (!statFile(archive, member(file)).unpacked)
      problems.push(`${file} is inside the archive, where the system cannot load it`)
    else if (!existsSync(join(`${archive}.unpacked`, member(file))))
      problems.push(`${file} is missing beside the archive`)
  }
  const native = natives.filter(file => file.includes(`/${target.native}/`) && file.endsWith('.node'))
  if (!native.length)
    problems.push(`No native addon for ${target.native}`)
  for (const file of native) {
    const path = join(`${archive}.unpacked`, member(file))
    const kind = existsSync(path) ? binaryKind(readFileSync(path)) : target.kind
    if (kind !== target.kind)
      problems.push(`${file} is ${kind}, not ${target.kind}`)
  }
  return { problems, stats: { files: installed.length, archived: files.length, longest, archiveBytes: statSync(archive).size, nativeAddons: native.length } }
}

async function main() {
  const name = process.argv[2]
  const platform = { windows: 'win32', linux: 'linux' }[name]
  if (!platform)
    throw new Error('Usage: pnpm verify:package windows|linux')
  const { version } = JSON.parse(await readFile('package.json', 'utf8'))
  const { problems, stats } = await checkPackage(platform, resolve('dist', name, 'Anna'), version)
  process.stdout.write(`${JSON.stringify(stats)}\n`)
  if (problems.length) {
    process.stderr.write(`${problems.join('\n')}\n`)
    process.exit(1)
  }
  process.stdout.write(`${name} package passed its static checks. This does not prove that it runs.\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => { console.error(error); process.exit(1) })
