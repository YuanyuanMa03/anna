import type { Dirent } from 'node:fs'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import { globRegExp, isSecretFile } from './paths'

/** Which files a recursive search reads besides plain ones (see `SearchScope` in commands.ts). */
export interface SearchReach { hidden: boolean, ignored: boolean, include: string[], exclude: string[] }

interface IgnoreRule { base: string, pattern: RegExp, anchored: boolean, negate: boolean, directory: boolean }

function ignoreRules(dir: string): IgnoreRule[] {
  let text = ''
  try { text = readFileSync(join(dir, '.gitignore'), 'utf8') }
  catch { return [] }
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map((line) => {
    const negate = line.startsWith('!')
    let pattern = negate ? line.slice(1) : line
    const directory = pattern.endsWith('/')
    pattern = pattern.replace(/\/+$/, '')
    const anchored = pattern.includes('/')
    return { base: dir, pattern: globRegExp(pattern.replace(/^\//, '')), anchored, negate, directory }
  })
}

/** Last matching rule wins, as in git; a path no rule matches is not ignored. */
function isIgnored(rules: IgnoreRule[], path: string, directory: boolean) {
  let ignored = false
  for (const rule of rules) {
    if (rule.directory && !directory)
      continue
    const subject = rule.anchored ? relative(rule.base, path).split('\\').join('/') : basename(path)
    if (rule.pattern.test(subject))
      ignored = !rule.negate
  }
  return ignored
}

function repositoryRoot(dir: string) {
  for (let current = dir; ; current = dirname(current)) {
    if (existsSync(join(current, '.git')))
      return current
    if (dirname(current) === current)
      return undefined
  }
}

function included(name: string, reach: SearchReach) {
  const matches = (glob: string) => glob.includes('/') || globRegExp(glob).test(name)
  return (!reach.include.length || reach.include.some(matches)) && !reach.exclude.some(glob => !glob.includes('/') && globRegExp(glob).test(name))
}

/**
 * Up to `limit` secret files (see `isSecretFile`) that a recursive search of `root` would read. Searches that honour
 * ignore files (rg, the grep tool, git grep) skip what `.gitignore` excludes inside a git repository; the rest read
 * everything. The walk is bounded (entries and depth) and never enters `.git` or `node_modules`, so it is a
 * best-effort guard against sending keys to the model, like Claude Code's checks on recognised file commands.
 */
export function secretsIn(root: string, reach: SearchReach, limit = 3, home?: string): string[] {
  let directory = false
  try { directory = statSync(root).isDirectory() }
  catch { return [] }
  if (!directory)
    return isSecretFile(root, home) ? [root] : []
  const repository = reach.ignored ? undefined : repositoryRoot(root)
  const inherited: IgnoreRule[] = []
  if (repository) {
    const chain: string[] = []
    for (let current = dirname(root); current === repository || current.startsWith(repository + sep); current = dirname(current)) {
      chain.unshift(current)
      // A repository at the file system root: dirname('/') is '/', so stop there.
      if (current === repository)
        break
    }
    for (const dir of chain) inherited.push(...ignoreRules(dir))
  }
  const found: string[] = []
  let budget = 5000
  const walk = (dir: string, depth: number, rules: IgnoreRule[]) => {
    if (found.length >= limit || depth > 12 || budget <= 0)
      return
    let entries: Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) }
    catch { return }
    budget -= entries.length
    const scoped = repository ? [...rules, ...ignoreRules(dir)] : rules
    for (const entry of entries) {
      if (found.length >= limit)
        return
      if (entry.name === '.git' || entry.name === 'node_modules' || (!reach.hidden && entry.name.startsWith('.')))
        continue
      const path = join(dir, entry.name)
      const isDirectory = entry.isDirectory()
      if (repository && isIgnored(scoped, path, isDirectory))
        continue
      if (isDirectory)
        walk(path, depth + 1, scoped)
      else if (isSecretFile(path, home) && included(entry.name, reach))
        found.push(path)
    }
  }
  walk(root, 0, inherited)
  return found
}
