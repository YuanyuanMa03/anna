import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { createPackageWithOptions } from '@electron/asar'

const packageName = specifier => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]

/** Copy each actual package once; preserve dependency versions and peer contexts with internal archive links. */
export async function stageDependencies(root, destination, names, omit = new Set()) {
  const packages = new Map()
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
  async function linkPackage(name, from, targetModules, optional = false) {
    if (name === 'electron' || omit.has(name))
      return
    const source = await locate(name, from, optional)
    if (!source)
      return
    let target = packages.get(source)
    if (!target) {
      const id = createHash('sha256').update(relative(root, source)).digest('hex').slice(0, 16)
      target = join(destination, '.store', id, 'node_modules', name)
      packages.set(source, target)
      await mkdir(dirname(target), { recursive: true })
      await cp(source, target, {
        recursive: true,
        verbatimSymlinks: true,
        filter: path => !relative(source, path).split(sep).includes('node_modules') && !path.endsWith('.map') && !/\.d\.[cm]?ts$/.test(path),
      })
      const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
      const requiredPeers = Object.fromEntries(Object.entries(manifest.peerDependencies ?? {}).filter(([name]) => !manifest.peerDependenciesMeta?.[name]?.optional))
      const dependencies = { ...requiredPeers, ...manifest.dependencies, ...manifest.optionalDependencies }
      for (const dependency of Object.keys(dependencies).sort()) {
        const optionalDependency = dependency in (manifest.optionalDependencies ?? {}) || manifest.peerDependenciesMeta?.[dependency]?.optional
        await linkPackage(dependency, source, dirname(target.endsWith(name) && name.startsWith('@') ? dirname(target) : target), optionalDependency)
      }
    }
    const link = join(targetModules, name)
    await mkdir(dirname(link), { recursive: true })
    const to = relative(dirname(link), target)
    await symlink(process.platform === 'win32' ? resolve(dirname(link), to) : to, link, process.platform === 'win32' ? 'junction' : 'dir')
  }
  await mkdir(destination, { recursive: true })
  for (const name of names)
    await linkPackage(name, root, destination)
  return packages.size
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
    await cp(join(root, path), join(stage, path), { recursive: true, filter: path => !path.endsWith('.map') })
  }
  await writeFile(join(stage, 'package.json'), JSON.stringify({ name: 'anna', productName: 'Anna', version: manifest.version, private: true, type: 'module', main: 'dist/host/apps/desktop/main.js' }, null, 2))
  await rm(join(resources, 'app'), { recursive: true, force: true })
  await rm(join(resources, 'app.asar'), { force: true })
  await rm(join(resources, 'app.asar.unpacked'), { recursive: true, force: true })
  await rm(join(resources, 'node_modules'), { recursive: true, force: true })
  await mkdir(resources, { recursive: true })
  await createPackageWithOptions(stage, join(resources, 'app.asar'), { unpack: '**/*.{node,dll,so,dylib,exe}' })
  for (const file of ['anna.ico', 'favicon.png'])
    await cp(join(root, 'dist/renderer', file), join(resources, file))
  const externalDependencyCount = await stageDependencies(root, join(resources, 'node_modules'), external)
  await rm(stage, { recursive: true, force: true })
  return { dependencyCount, externalDependencyCount, runtimeDependencies: names, archive: 'app.asar' }
}
