import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const unicodeSpaces = /[\xA0\u2000-\u200A\u202F\u205F\u3000]/g

/** Convert Git Bash, MSYS, Cygwin and WSL drive paths the way pi does on Windows. */
function windowsShellPath(path: string) {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
    return path
  const match = /^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i.exec(path)
  return match ? `${match[1]!.toUpperCase()}:\\${match[2]?.replaceAll('/', '\\') ?? ''}` : path
}

/**
 * Resolve a tool path exactly as pi's tools do (`@` prefix, unicode spaces, `~`, `file://`, Windows shell paths),
 * so the policy judges the same file the tool will touch.
 */
export function resolveToolPath(input: string, cwd: string, platform: NodeJS.Platform = process.platform, home = homedir()) {
  let path = input.replace(unicodeSpaces, ' ')
  if (path.startsWith('@'))
    path = path.slice(1)
  if (platform === 'win32')
    path = windowsShellPath(path)
  if (path === '~')
    path = home
  else if (path.startsWith('~/') || (platform === 'win32' && path.startsWith('~\\')))
    path = join(home, path.slice(2))
  if (path.startsWith('file://'))
    path = fileURLToPath(path)
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path)
}

/** Follow symlinks on the longest existing prefix, so links inside the workspace cannot point writes outside it. */
export function canonical(path: string): string {
  try { return realpathSync.native(path) }
  catch {
    const parent = dirname(path)
    return parent === path ? path : join(canonical(parent), basename(path))
  }
}

export function isInside(root: string, target: string, platform: NodeJS.Platform = process.platform) {
  const fold = (value: string) => platform === 'win32' || platform === 'darwin' ? value.toLowerCase() : value
  const path = relative(fold(root), fold(target))
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

/** Paths whose contents must never reach a model or be changed by a tool, regardless of mode or rules. */
export function sensitivePaths(home = homedir(), platform: NodeJS.Platform = process.platform) {
  const paths = ['.ssh', '.aws', '.gnupg', '.kube', '.docker/config.json', '.netrc', '.npmrc', '.pypirc', '.git-credentials', '.config/gh', '.config/gcloud', '.azure', '.pi', '.claude', '.codex'].map(name => join(home, name))
  if (platform === 'darwin')
    paths.push(join(home, 'Library/Keychains'), join(home, 'Library/Application Support/Google/Chrome'), join(home, 'Library/Cookies'))
  if (platform === 'win32')
    paths.push(join(home, 'AppData/Roaming/Microsoft/Credentials'), join(home, 'AppData/Local/Microsoft/Credentials'))
  return paths
}

/** File names that usually hold secrets wherever they live. */
export function isSecretFile(path: string) {
  const name = basename(path).toLowerCase()
  return name === '.env' || (name.startsWith('.env.') && !name.endsWith('.example') && !name.endsWith('.sample') && !name.endsWith('.template')) || /^id_(?:rsa|ed25519|ecdsa|dsa)$/.test(name) || name.endsWith('.pem') || name.endsWith('.p12') || name.endsWith('.key')
}
