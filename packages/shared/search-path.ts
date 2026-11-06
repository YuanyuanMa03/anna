import { join } from 'node:path'

/**
 * The agent's grep and find tools run ripgrep and fd. Without them on the path, pi downloads both from GitHub on first
 * use, which fails offline or where GitHub is blocked. The packaged app ships them in resources/bin and puts that folder
 * first on the core's path.
 *
 * Windows treats variable names without regard to case, but a plain object does not: spreading `process.env` there
 * yields `Path`, and adding `PATH` beside it would leave the child to pick one of the two. Should a spelling ever appear
 * twice, the first wins and the others are dropped.
 */
export function withSearchTools(env: Record<string, string | undefined>, directory: string, platform: NodeJS.Platform): Record<string, string | undefined> {
  const windows = platform === 'win32'
  const keys = Object.keys(env).filter(key => windows ? key.toUpperCase() === 'PATH' : key === 'PATH')
  const key = keys[0] ?? 'PATH'
  const current = env[key]
  const next = { ...env }
  for (const other of keys.slice(1))
    delete next[other]
  next[key] = current ? `${directory}${windows ? ';' : ':'}${current}` : directory
  return next
}

/**
 * The packaged core's environment: the bundled tools first on the path, and pi told it is offline, so a missing tool is
 * reported instead of fetched from GitHub, and pi makes no version or catalogue checks of its own. Anna's model calls
 * are made with explicit endpoints and are not affected.
 */
export function packagedCoreEnv(env: Record<string, string | undefined>, resources: string, platform: NodeJS.Platform): Record<string, string | undefined> {
  return { ...withSearchTools(env, join(resources, 'bin'), platform), PI_OFFLINE: '1' }
}
