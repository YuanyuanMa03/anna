import type { CommandClass } from './commands'
import type { PermissionMode } from './modes'
import type { RuleSet } from './rules'
import { tmpdir } from 'node:os'
import { dirname, relative } from 'node:path'
import process from 'node:process'
import { classify, commandPrefix } from './commands'
import { modes } from './modes'
import { canonical, isInside, isSecretFile, resolveToolPath, sensitivePaths } from './paths'
import { evaluateRules, pathRule } from './rules'

export interface PolicyContext {
  mode: PermissionMode
  /** Canonical workspace path. */
  workspace: string
  /** Shell commands run inside the OS sandbox (writes confined to the workspace, network asks). */
  sandboxed: boolean
  rules: RuleSet
  /** Anna's own secrets and state; never reachable by tools. */
  protectedPaths: string[]
  platform?: NodeJS.Platform
  home?: string
}

export type Decision
  = | { kind: 'allow', note?: string }
    | { kind: 'deny', reason: string }
    | { kind: 'ask', reason: string, details: string, danger: boolean, /** Rule that "always allow" would add; absent for dangerous calls. */ rule?: string, commandClass?: CommandClass }

const readTools = new Set(['read', 'ls', 'grep', 'find'])
const writeTools = new Set(['write', 'edit'])
const shellTools = new Set(['bash', 'powershell'])

function guard(path: string, context: PolicyContext): Decision | undefined {
  const platform = context.platform ?? process.platform
  if (context.protectedPaths.some(root => isInside(root, path, platform)))
    return { kind: 'deny', reason: '这是 Anna 自己的凭据与数据，工具不能读取或修改。' }
  if (sensitivePaths(context.home, platform).some(root => isInside(canonical(root), path, platform)))
    return { kind: 'deny', reason: `${path} 存放凭据或隐私数据，Anna 不会读取或修改它。` }
}

/** How a path appears on an approval card: relative inside the workspace, absolute outside. */
function shown(path: string, context: PolicyContext) {
  return isInside(context.workspace, path, context.platform) ? relative(context.workspace, path) || '.' : path
}

function judgeRead(path: string, context: PolicyContext): Decision {
  const blocked = guard(path, context)
  if (blocked)
    return blocked
  const ruled = evaluateRules(context.rules, 'Read', path, context.workspace)
  if (ruled === 'deny')
    return { kind: 'deny', reason: '你的权限规则禁止读取这个位置。' }
  const inside = isInside(context.workspace, path, context.platform)
  if (ruled === 'allow' || (inside && !isSecretFile(path)) || (context.mode === 'auto' && !isSecretFile(path) && ruled !== 'ask'))
    return { kind: 'allow' }
  if (isSecretFile(path))
    return { kind: 'ask', reason: '读取可能含有密钥的文件，内容会发送给模型', details: shown(path, context), danger: true }
  return { kind: 'ask', reason: '读取工作文件夹之外的内容，内容会发送给模型', details: path, danger: false, rule: pathRule('Read', `${dirname(path)}/**`, context.workspace) }
}

function judgeWrite(path: string, context: PolicyContext): Decision {
  const blocked = guard(path, context)
  if (blocked)
    return blocked
  if (context.mode === 'plan')
    return { kind: 'deny', reason: '现在是规划模式，只能查看、不能修改。请先给出方案，等用户切换模式后再动手。' }
  const ruled = evaluateRules(context.rules, 'Edit', path, context.workspace)
  if (ruled === 'deny')
    return { kind: 'deny', reason: '你的权限规则禁止修改这个位置。' }
  const inside = isInside(context.workspace, path, context.platform)
  if (!inside)
    return ruled === 'allow' ? { kind: 'allow' } : { kind: 'ask', reason: '修改工作文件夹之外的文件', details: path, danger: true }
  if (isSecretFile(path) && ruled !== 'allow')
    return { kind: 'ask', reason: '修改可能含有密钥的文件', details: shown(path, context), danger: true }
  if (ruled === 'allow' || (ruled !== 'ask' && (context.mode === 'edit' || context.mode === 'auto')))
    return { kind: 'allow' }
  return { kind: 'ask', reason: '修改文件', details: shown(path, context), danger: false, rule: pathRule('Edit', path, context.workspace) }
}

/** Path-looking words in a command, resolved the way the shell would see them. */
function commandPaths(command: string, context: PolicyContext) {
  const words = command.match(/(?:"[^"]*"|'[^']*'|\S)+/g) ?? []
  return words
    .map(word => word.replace(/^['"]|['"]$/g, '').replace(/^-[\w-]+=/, ''))
    .filter(word => /^(?:~|\.{1,2}(?:\/|$)|\/|[a-z]:\\)/i.test(word) || word.includes('/'))
    .filter(word => !/^[a-z]+:\/\//i.test(word) && !/^\/dev\/(?:null|stdout|stderr|tty)$/.test(word))
    .map(word => canonical(resolveToolPath(word, context.workspace, context.platform, context.home)))
}

function judgeCommand(command: string, context: PolicyContext): Decision {
  const platform = context.platform ?? process.platform
  for (const path of commandPaths(command, context)) {
    const blocked = guard(path, context)
    if (blocked)
      return { kind: 'deny', reason: `命令涉及受保护的位置：${blocked.kind === 'deny' ? blocked.reason : ''}` }
  }
  const kind = classify(command)
  const ruled = evaluateRules(context.rules, 'Bash', command, context.workspace)
  if (ruled === 'deny')
    return { kind: 'deny', reason: '你的权限规则禁止这条命令。' }
  const details = command.slice(0, 1200)
  if (kind === 'danger')
    return context.mode === 'plan' ? { kind: 'deny', reason: '规划模式下不执行高风险命令。' } : { kind: 'ask', reason: '这条命令可能造成难以撤销的影响', details, danger: true, commandClass: kind }
  const outside = commandPaths(command, context).filter(path => !isInside(context.workspace, path, platform) && !isInside(canonical(tmpdir()), path, platform))
  if (context.mode === 'plan') {
    if (kind !== 'inspect')
      return { kind: 'deny', reason: '现在是规划模式，只运行查看类命令。请先给出方案，等用户切换模式后再执行。' }
    return outside.length && ruled !== 'allow' ? { kind: 'ask', reason: '查看工作文件夹之外的内容', details, danger: false, rule: `Bash(${commandPrefix(command)}:*)`, commandClass: kind } : { kind: 'allow' }
  }
  if (ruled === 'allow')
    return { kind: 'allow' }
  const ask = (reason: string): Decision => ({ kind: 'ask', reason, details, danger: false, rule: `Bash(${commandPrefix(command)}:*)`, commandClass: kind })
  if (ruled === 'ask')
    return ask('你的规则要求这条命令先确认')
  if (outside.length && context.mode !== 'auto' && kind === 'inspect')
    return ask('查看工作文件夹之外的内容')
  if (outside.length && !context.sandboxed && kind !== 'inspect')
    return { kind: 'ask', reason: '命令涉及工作文件夹之外的路径', details, danger: true, commandClass: kind }
  switch (context.mode) {
    case 'ask':
      return kind === 'inspect' ? { kind: 'allow' } : ask(kind === 'network' ? '运行需要联网的命令' : '运行命令')
    case 'edit':
      return kind === 'inspect' || kind === 'verify' ? { kind: 'allow' } : ask(kind === 'network' ? '运行需要联网的命令' : '运行命令')
    case 'auto':
      if (context.sandboxed)
        return { kind: 'allow', note: '沙箱' }
      return kind === 'inspect' || kind === 'verify' ? { kind: 'allow' } : ask('这台电脑没有可用的沙箱，命令需要确认')
  }
}

/** Decide one tool call. Pure: no IO except path canonicalization. */
export function decide(tool: string, input: Record<string, unknown>, context: PolicyContext): Decision {
  const platform = context.platform ?? process.platform
  const target = (value: unknown) => canonical(resolveToolPath(typeof value === 'string' && value ? value : '.', context.workspace, platform, context.home))
  if (readTools.has(tool))
    return judgeRead(target(input.path), context)
  if (writeTools.has(tool))
    return judgeWrite(target(input.path), context)
  if (shellTools.has(tool))
    return judgeCommand(String(input.command ?? ''), context)
  if (tool.startsWith('anna_'))
    return { kind: 'allow' }
  return context.mode === 'auto' ? { kind: 'allow' } : { kind: 'ask', reason: `调用工具 ${tool}`, details: JSON.stringify(input).slice(0, 1200), danger: false, rule: undefined }
}

export function describeMode(mode: PermissionMode) { return modes[mode] }
