import { cp, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { createPackageWithOptions } from '@electron/asar'

const packageName = specifier => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]

/** Native command-line binaries the app never runs: Anna only reads the agent's session files through this SDK. */
const unusedPackage = name => name === 'electron' || name.startsWith('@anthropic-ai/claude-agent-sdk-')

/**
 * A plain node_modules with no links: each package once at the top, and nested under whichever package needs another
 * version. Links in an archive are one more thing that must work on every platform, and copying them as folders is what
 * once multiplied the Windows package to 132,172 files. A package's own dependencies are placed before anything below it,
 * so nothing deeper can find a shared version and then have the package's own one appear in between.
 */
export async function stageDependencies(root, destination, names, omit = new Set()) {
  async function locate(name, from, optional) {
    const require = createRequire(join(from, 'package.json'))
    for (const directory of require.resolve.paths(name) ?? []) {
      try {
        const path = await realpath(join(directory, name))
        await lstat(join(path, 'package.json'))
        return path
      }
      catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')
          throw error
      }
    }
    if (!optional)
      throw new Error(`Missing runtime dependency ${name} from ${from}`)
  }
  const top = { modules: destination, parent: undefined, placed: new Map() }
  const visibleFrom = (level, name) => {
    for (let current = level; current; current = current.parent) {
      if (current.placed.has(name))
        return current.placed.get(name)
    }
  }
  const queue = []
  let count = 0
  async function place(name, from, level, optional = false) {
    if (unusedPackage(name) || omit.has(name))
      return
    const source = await locate(name, from, optional)
    if (!source)
      return
    const visible = visibleFrom(level, name)
    if (visible === source)
      return
    const home = visible ? level : top
    const target = join(home.modules, name)
    home.placed.set(name, source)
    count++
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target, {
      recursive: true,
      verbatimSymlinks: true,
      filter: path => !relative(source, path).split(sep).includes('node_modules') && !path.endsWith('.map') && !path.endsWith('.DS_Store') && !/\.d\.[cm]?ts$/.test(path),
    })
    queue.push({ source, level: { modules: join(target, 'node_modules'), parent: home, placed: new Map() } })
  }
  await mkdir(destination, { recursive: true })
  for (const name of names)
    await place(name, root, top)
  for (let next = 0; next < queue.length; next++) {
    const { source, level } = queue[next]
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    const requiredPeers = Object.fromEntries(Object.entries(manifest.peerDependencies ?? {}).filter(([name]) => !manifest.peerDependenciesMeta?.[name]?.optional))
    const dependencies = { ...requiredPeers, ...manifest.dependencies, ...manifest.optionalDependencies }
    for (const dependency of Object.keys(dependencies).sort()) {
      const optional = dependency in (manifest.optionalDependencies ?? {}) || manifest.peerDependenciesMeta?.[dependency]?.optional
      await place(dependency, source, level, optional)
    }
  }
  return count
}

/** The longest path below `root` in characters: Windows tools still stumble at 260 once the install folder is added. */
export async function longestPath(root) {
  let longest = 0
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true }))
    longest = Math.max(longest, relative(root, join(entry.parentPath, entry.name)).length)
  return longest
}

/** What the operating system must load from a real file. Asar matches this against each file's name. */
export const unpackedFiles = '*.{node,dll,so,dylib,exe}'

async function assertNoLinks(root) {
  const links = (await readdir(root, { withFileTypes: true, recursive: true })).filter(entry => entry.isSymbolicLink())
  if (links.length)
    throw new Error(`The app would ship links: ${links.slice(0, 5).map(entry => join(entry.parentPath, entry.name)).join(', ')}`)
}

/** Only built output and the Host's actual external dependency closure enter the app. */
export async function stageRuntime(root, resources) {
  const stage = join(root, '.data', 'runtime-stage')
  await rm(stage, { recursive: true, force: true })
  await mkdir(stage, { recursive: true })
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const build = JSON.parse(await readFile(join(root, 'dist/host/runtime-dependencies.json'), 'utf8'))
  const names = [...new Set(build.map(packageName))].sort()
  for (const name of names) {
    if (!manifest.dependencies[name])
      throw new Error(`Undeclared runtime dependency: ${name}`)
  }
  // Sandbox helpers are real executables (and a JVM agent), so their package stays on disk.
  // Node resolves this external closure beside app.asar; no executable is spawned from inside an archive.
  const external = ['@anthropic-ai/sandbox-runtime'].filter(name => names.includes(name))
  const dependencyCount = await stageDependencies(root, join(stage, 'node_modules'), names, new Set(external))
  for (const path of ['dist/host', 'dist/renderer', 'plugins/anna-persona/persona.md', 'LICENSE', 'NOTICE.md']) {
    await mkdir(dirname(join(stage, path)), { recursive: true })
    await cp(join(root, path), join(stage, path), { recursive: true, filter: path => !path.endsWith('.map') && !path.endsWith('.DS_Store') })
  }
  await writeFile(join(stage, 'package.json'), JSON.stringify({ name: 'anna', productName: 'Anna', version: manifest.version, private: true, type: 'module', main: 'dist/host/apps/desktop/boot.js' }, null, 2))
  await rm(join(resources, 'app'), { recursive: true, force: true })
  await rm(join(resources, 'app.asar'), { force: true })
  await rm(join(resources, 'app.asar.unpacked'), { recursive: true, force: true })
  await rm(join(resources, 'node_modules'), { recursive: true, force: true })
  await mkdir(resources, { recursive: true })
  await assertNoLinks(stage)
  await createPackageWithOptions(stage, join(resources, 'app.asar'), { unpack: unpackedFiles })
  for (const file of ['anna.ico', 'favicon.png'])
    await cp(join(root, 'dist/renderer', file), join(resources, file))
  const externalDependencyCount = await stageDependencies(root, join(resources, 'node_modules'), external)
  await assertNoLinks(join(resources, 'node_modules'))
  await rm(stage, { recursive: true, force: true })
  return { dependencyCount, externalDependencyCount, runtimeDependencies: names, archive: 'app.asar' }
}
