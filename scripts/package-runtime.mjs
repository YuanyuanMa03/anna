import { readdir, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'

/** A flat node_modules: pnpm's store nests every dependency's peers, which multiplies files and path length on Windows. */
export const runtimeDeployFlags = ['--config.node-linker=hoisted']

const unused = /\.(?:d\.[cm]?ts|d\.[cm]?ts\.map|[cm]?js\.map|css\.map|ts\.map)$/
/** Pulled in only as optional peers: Electron is the outer app, and TypeScript is never run. */
const unusedPackages = new Set(['electron', 'typescript'])

/** Remove what the running app never reads from a deployed node_modules. Symlinks are left alone. */
export async function pruneRuntime(nodeModules) {
  for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
    const path = join(nodeModules, entry.name)
    // Launchers for command-line use, some now pointing at removed packages: a dangling link breaks signing and archiving.
    if (entry.name === '.bin' && isPackageFolder(nodeModules))
      await rm(path, { recursive: true, force: true })
    else if (entry.isDirectory() && unusedPackages.has(entry.name) && isPackageFolder(nodeModules))
      await rm(path, { recursive: true, force: true })
    else if (entry.isDirectory())
      await pruneRuntime(path)
    else if (entry.isFile() && unused.test(entry.name))
      await rm(path, { force: true })
  }
}

function isPackageFolder(folder) {
  return /[\\/]node_modules$/.test(folder)
}

/** The longest path below `root` in characters: Windows tools still stumble at 260 once the install folder is added. */
export async function longestPath(root) {
  let longest = 0
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true }))
    longest = Math.max(longest, relative(root, join(entry.parentPath, entry.name)).length)
  return longest
}
