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

/** A path and the location it resolves to (one entry when they are the same). */
export function spellings(path: string) {
  const real = canonical(path)
  return real === path ? [path] : [path, real]
}

/** Each path as written and as resolved. Seatbelt and bubblewrap check the resolved path, so a sandbox needs both. */
export function withRealPaths(paths: string[]) {
  return [...new Set(paths.flatMap(spellings))]
}

/** A glob as a regular expression: `*` and `?` stay within one path segment, `**` crosses segments. */
export function globRegExp(glob: string, flags = '') {
  let source = ''
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!
    if (char === '*' && glob[index + 1] === '*') {
      const slash = glob[index + 2] === '/'
      source += slash ? '(?:.*/)?' : '.*'
      index += slash ? 2 : 1
    }
    else if (char === '*') { source += '[^/]*' }
    else if (char === '?') { source += '[^/]' }
    else if (char === '[' && glob.indexOf(']', index + 2) > 0) {
      const end = glob.indexOf(']', index + 2)
      source += `[${glob.slice(index + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`
      index = end
    }
    else { source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&') }
  }
  return new RegExp(`^${source}$`, flags)
}

/** Whether a shell glob in a command (`~/.s?h/id_rsa`) could expand to `root` or to something inside it. */
export function globMayReach(pattern: string, root: string, platform: NodeJS.Platform = process.platform) {
  if (!/[*?[]/.test(pattern))
    return false
  const flags = platform === 'win32' || platform === 'darwin' ? 'i' : ''
  const globs = pattern.split(/[\\/]/)
  const names = root.split(/[\\/]/)
  if (globs.length < names.length && !globs.includes('**'))
    return false
  for (let index = 0; index < names.length; index++) {
    const glob = globs[index]!
    if (glob === '**')
      return true
    // Shells leave dotfiles out of `*` unless the pattern itself starts with a dot.
    if (!globRegExp(glob, flags).test(names[index]!) || (names[index]!.startsWith('.') && !glob.startsWith('.')))
      return false
  }
  return true
}

/** Credential files with names of their own, wherever they live. */
const credentialNames = new Set(['.npmrc', '.netrc', '_netrc', '.pypirc', '.git-credentials', '.pgpass'])
/**
 * Where coding agents and CLIs keep logins and keys under the home folder (several of them are written by Anna's and
 * cc-switch's own provider switching). Reading any of these sends a key to the model.
 */
const credentialPaths = ['.codex/auth.json', '.codex/config.toml', '.claude/settings.json', '.claude/.credentials.json', '.claude.json', '.gemini/oauth_creds.json', '.cc-switch/cc-switch.db', '.aws/credentials', '.docker/config.json', '.config/gh/hosts.yml', '.kube/config']

/** Files that usually hold secrets: by name anywhere (`.env`, private keys, `.npmrc` …), or a known credential file in `home`. */
export function isSecretFile(path: string, home = homedir()) {
  const name = basename(path).toLowerCase()
  if (name === '.env' || (name.startsWith('.env.') && !name.endsWith('.example') && !name.endsWith('.sample') && !name.endsWith('.template')) || /^id_(?:rsa|ed25519|ecdsa|dsa)$/.test(name) || name.endsWith('.pem') || name.endsWith('.p12') || name.endsWith('.key') || credentialNames.has(name))
    return true
  const inHome = relative(home, path).split(sep).join('/')
  const fold = (value: string) => process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value
  return credentialPaths.some(known => fold(inHome) === fold(known))
}
