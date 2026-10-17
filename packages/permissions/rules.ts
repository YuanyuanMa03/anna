import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

/**
 * Permission rules in the Claude Code style:
 *   Bash(pnpm test)        exact command
 *   Bash(pnpm install:*)   command prefix
 *   Read(~/notes/**)       path glob; relative globs are relative to the workspace, `//` means absolute
 *   Edit(src/**)           covers write and edit
 *   Network(registry.npmjs.org) / Network(*.github.com)
 * Precedence: deny > ask > allow.
 */
export type RuleTool = 'Bash' | 'Read' | 'Edit' | 'Network'
export interface Rule { tool: RuleTool, pattern: string, raw: string }
export interface RuleSet { allow: string[], ask: string[], deny: string[] }
export const emptyRules = (): RuleSet => ({ allow: [], ask: [], deny: [] })

export function parseRule(raw: string): Rule | undefined {
  const match = /^(Bash|Read|Edit|Network)\((.+)\)$/.exec(raw.trim())
  return match ? { tool: match[1] as RuleTool, pattern: match[2]!.trim(), raw: raw.trim() } : undefined
}

function globToRegExp(glob: string) {
  let source = ''
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!
    if (char === '*' && glob[index + 1] === '*') {
      source += '.*'
      index++
      if (glob[index + 1] === '/')
        index++
    }
    else if (char === '*') { source += '[^/]*' }
    else if (char === '?') { source += '[^/]' }
    else { source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&') }
  }
  return new RegExp(`^${source}$`, 'i')
}

function pathGlob(pattern: string, workspace: string) {
  if (pattern.startsWith('//'))
    return pattern.slice(1)
  if (pattern === '~' || pattern.startsWith('~/'))
    return join(homedir(), pattern.slice(1))
  return isAbsolute(pattern) ? pattern : resolve(workspace, pattern)
}

export function ruleMatches(rule: Rule, tool: RuleTool, subject: string, workspace: string) {
  if (rule.tool !== tool)
    return false
  if (tool === 'Bash') {
    const command = subject.trim().replace(/\s+/g, ' ')
    return rule.pattern.endsWith(':*') ? command === rule.pattern.slice(0, -2) || command.startsWith(`${rule.pattern.slice(0, -2)} `) : command === rule.pattern
  }
  if (tool === 'Network')
    return globToRegExp(rule.pattern.replace(/\*\./, '**.')).test(subject) || rule.pattern === subject
  const glob = pathGlob(rule.pattern, workspace).split('\\').join('/')
  const target = subject.split('\\').join('/')
  return globToRegExp(glob).test(target) || (glob.endsWith('/**') && target === glob.slice(0, -3))
}

/** The strongest verdict any rule gives for this subject. */
export function evaluateRules(rules: RuleSet, tool: RuleTool, subject: string, workspace: string): 'deny' | 'ask' | 'allow' | undefined {
  for (const kind of ['deny', 'ask', 'allow'] as const) {
    if (rules[kind].some((raw) => { const rule = parseRule(raw); return rule ? ruleMatches(rule, tool, subject, workspace) : false }))
      return kind
  }
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

/** A readable rule for a path relative to the workspace when possible. */
export function pathRule(tool: 'Read' | 'Edit', path: string, workspace: string) {
  const inside = relative(workspace, path)
  return !inside.startsWith('..') && !isAbsolute(inside) ? `${tool}(${inside.split('\\').join('/')})` : `${tool}(/${path.split('\\').join('/')})`
}
