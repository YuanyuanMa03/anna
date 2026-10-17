import { homedir } from 'node:os'
import { isAbsolute, relative } from 'node:path'
import process from 'node:process'
import { looseParts, segments, stripWrappers } from './commands'
import { globRegExp, isInside } from './paths'

/**
 * Permission rules in Claude Code's format, matched the way Claude Code matches them
 * (https://code.claude.com/docs/en/permissions):
 *   Bash                    every command
 *   Bash(pnpm test)         exactly this command
 *   Bash(pnpm install *)    `*` matches any text; a trailing ` *` also matches the bare command; `:*` means ` *`
 *   Read(~/notes/**)        gitignore-style paths: `//` absolute, `~/` home, `/` and `./` the workspace root
 *   Read(.env)              a bare name matches at any depth under the workspace
 *   Edit(src/**)            covers write and edit
 *   Network(*.github.com)   sandbox network access (Anna's own; Claude Code uses `WebFetch(domain:…)`)
 * Precedence is deny > ask > allow whatever the specificity. A compound command (`a && b`) is allowed only when every
 * part is, a line that cannot be parsed never matches an allow rule, and deny or ask rules match any part of it.
 * Paths are checked as requested and as resolved: deny or ask rules need either; allow rules need both, except that a
 * `//` or `~/` rule also covers where its own path leads.
 */
export type RuleTool = 'Bash' | 'Read' | 'Edit' | 'Network'
/** `pattern` is undefined for a bare tool name (`Bash`), which matches every use of the tool. */
export interface Rule { tool: RuleTool, pattern?: string, raw: string }
export interface RuleSet { allow: string[], ask: string[], deny: string[] }
export type Verdict = 'deny' | 'ask' | 'allow'
export interface RuleOptions {
  home?: string
  platform?: NodeJS.Platform
  /** Only allow rules whose literal base lies inside this path count (a rule that names this very secret file). */
  within?: string
}
export const emptyRules = (): RuleSet => ({ allow: [], ask: [], deny: [] })
const kinds = ['deny', 'ask', 'allow'] as const

export function parseRule(raw: string): Rule | undefined {
  const match = /^(Bash|Read|Edit|Network)(?:\((.*)\))?$/s.exec(raw.trim())
  if (!match)
    return undefined
  const pattern = match[2]?.trim()
  return { tool: match[1] as RuleTool, pattern: pattern && pattern !== '*' ? pattern : undefined, raw: raw.trim() }
}

function bashMatches(pattern: string | undefined, command: string) {
  if (pattern === undefined)
    return true
  const text = command.trim().replace(/\s+/g, ' ')
  let rule = pattern.replace(/\s+/g, ' ')
  if (rule.endsWith(':*'))
    rule = `${rule.slice(0, -2)} *`
  if (!rule.includes('*'))
    return text === rule
  if (rule.endsWith(' *') && rule.indexOf('*') === rule.length - 1 && text === rule.slice(0, -2))
    return true
  return new RegExp(`^${rule.split('*').map(piece => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's').test(text)
}

const posix = (path: string) => path.split('\\').join('/')

/** The absolute globs a path pattern stands for (two for a single-slash deny or ask pattern, see below). */
function pathGlobs(pattern: string, kind: Verdict, workspace: string, home: string) {
  const root = posix(workspace).replace(/\/$/, '')
  const p = pattern.endsWith('/') ? `${pattern}**` : pattern
  if (p.startsWith('//')) {
    const path = p.slice(1)
    return [/^\/[a-z]:/i.test(path) ? path.slice(1) : path]
  }
  if (p === '~' || p.startsWith('~/'))
    return [posix(home) + p.slice(1)]
  if (/^\/[a-z]:\//i.test(p) || /^[a-z]:\//i.test(posix(p)))
    return [posix(p).replace(/^\//, '')]
  // `/path` is the workspace root in Claude Code. Rules saved by older Anna versions used it for absolute paths, so
  // deny and ask rules keep guarding that reading too; they must never loosen on upgrade.
  if (p.startsWith('/'))
    return kind === 'allow' ? [root + p] : [root + p, p]
  if (p.startsWith('./'))
    return [`${root}/${p.slice(2)}`]
  const parts = p.split('/')
  const anyDepth = parts.length === 1 || (kind !== 'allow' && parts.length === 2 && parts[1] === '**')
  return [anyDepth ? `${root}/**/${p}` : `${root}/${p}`]
}

function pathMatches(rule: Rule, kind: Verdict, subject: string, workspace: string, home: string) {
  if (rule.pattern === undefined)
    return true
  const target = posix(subject)
  // Like gitignore, a pattern that names a directory also covers everything inside it.
  return pathGlobs(rule.pattern, kind, workspace, home).some(glob => globRegExp(glob, 'i').test(target) || globRegExp(`${glob}/**`, 'i').test(target))
}

/** The literal directory a path rule starts from: everything before its first wildcard. */
function ruleBase(rule: Rule, workspace: string, home: string) {
  const glob = pathGlobs(rule.pattern ?? '**', 'allow', workspace, home)[0]!
  const wildcard = glob.search(/[*?[]/)
  return wildcard < 0 ? glob : glob.slice(0, Math.max(glob.lastIndexOf('/', wildcard), 0)) || '/'
}

function parsed(rules: RuleSet, tool: RuleTool) {
  const pick = (list: string[]) => list.map(parseRule).filter((rule): rule is Rule => rule?.tool === tool)
  return { deny: pick(rules.deny), ask: pick(rules.ask), allow: pick(rules.allow) }
}

function commandVerdict(rules: ReturnType<typeof parsed>, command: string): Verdict | undefined {
  const parts = segments(command)
  const pieces = [command, ...(parts ?? looseParts(command))].flatMap((piece) => {
    const bare = stripWrappers(piece)
    return bare === piece ? [piece] : [piece, bare]
  })
  for (const kind of ['deny', 'ask'] as const) {
    if (rules[kind].some(rule => pieces.some(piece => bashMatches(rule.pattern, piece))))
      return kind
  }
  if (parts?.every(part => rules.allow.some(rule => bashMatches(rule.pattern, part))))
    return 'allow'
}

/** The strongest verdict any rule gives. Paths may be passed with every spelling (requested and resolved). */
export function evaluateRules(rules: RuleSet, tool: RuleTool, subject: string | string[], workspace: string, options: RuleOptions = {}): Verdict | undefined {
  const set = parsed(rules, tool)
  if (tool === 'Bash')
    return commandVerdict(set, String(subject))
  if (tool === 'Network') {
    const host = String(subject).toLowerCase().replace(/\.$/, '')
    return kinds.find(kind => set[kind].some(rule => rule.pattern === undefined || rule.pattern.toLowerCase() === host || globRegExp(rule.pattern.toLowerCase().replace(/^\*\./, '**.')).test(host)))
  }
  const home = options.home ?? homedir()
  const subjects = Array.isArray(subject) ? subject : [subject]
  for (const kind of ['deny', 'ask'] as const) {
    if (set[kind].some(rule => subjects.some(path => pathMatches(rule, kind, path, workspace, home))))
      return kind
  }
  const allows = options.within ? set.allow.filter(rule => rule.pattern !== undefined && isInside(posix(options.within!), ruleBase(rule, workspace, home), options.platform ?? process.platform)) : set.allow
  if (subjects.every(path => allows.some(rule => pathMatches(rule, 'allow', path, workspace, home))))
    return 'allow'
  // A rule anchored outside the workspace (`//…`, `~/…`) names the path the user chose, so it also covers where that
  // path leads (`~/.ssh` linking into `~/.local/config`). Workspace-relative rules never follow a link out.
  if (allows.some(rule => /^(?:\/\/|~(?:\/|$))/.test(rule.pattern ?? '') && pathMatches(rule, 'allow', subjects[0]!, workspace, home)))
    return 'allow'
}

/** The parts of a parseable command no Bash allow rule covers; undefined when the line cannot be parsed. */
export function uncoveredParts(rules: RuleSet, command: string) {
  const parts = segments(command)
  const allows = parsed(rules, 'Bash').allow
  return parts?.filter(part => !allows.some(rule => bashMatches(rule.pattern, part)))
}

export function mergeRules(...sets: (RuleSet | undefined)[]): RuleSet {
  const out = emptyRules()
  for (const set of sets) {
    if (!set)
      continue
    for (const kind of ['allow', 'ask', 'deny'] as const) out[kind].push(...set[kind])
  }
  return out
}

/**
 * The rule "always allow" saves for a path: relative inside the workspace (`./name` at the top level, so it does not
 * match the same name deeper down), `//absolute` outside. Undefined for paths with wildcard characters in them.
 */
export function pathRule(tool: 'Read' | 'Edit', path: string, workspace: string, tree = false) {
  if (/[*?[\]]/.test(path))
    return undefined
  const suffix = tree ? '/**' : ''
  const inside = posix(relative(workspace, path))
  if (inside && !inside.startsWith('..') && !isAbsolute(inside))
    return `${tool}(${inside.includes('/') ? inside : `./${inside}`}${suffix})`
  const absolute = posix(path)
  return `${tool}(/${absolute.startsWith('/') ? absolute : `/${absolute}`}${suffix})`
}
