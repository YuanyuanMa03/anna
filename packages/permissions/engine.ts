import type { CommandClass, SearchScope } from './commands'
import type { PermissionMode } from './modes'
import type { RuleSet } from './rules'
import type { SearchReach } from './secrets'
import { statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, relative } from 'node:path'
import process from 'node:process'
import { classify, classifyIn, commandRank, commandRule, looseParts, searchScope, segments, shellWords, stripWrappers } from './commands'
import { modes } from './modes'
import { canonical, globMayReach, isInside, isSecretFile, resolveToolPath, spellings, withRealPaths } from './paths'
import { evaluateRules, pathRule, uncoveredParts } from './rules'
import { secretsIn } from './secrets'

/**
 * Anna's policy, modelled on Claude Code's permission modes and rules and on Codex's sandbox modes and approval
 * policies (see modes.ts). Every path, `~/.ssh` and `~/.aws` included, follows the mode and the rules, as in Claude
 * Code: reads outside the workspace ask (Auto mode reads freely), writes outside it ask every time. Two exceptions:
 * - Anna's own keys and data (`protectedPaths`) are unreachable. No mode, rule or approval opens them.
 * - Secret files (`.env`, private keys) ask before their contents go to the model, whether a file tool or a shell
 *   command names them or a recursive search would read them. "Always allow" remembers the file.
 */
export interface PolicyContext {
  mode: PermissionMode
  /** Canonical workspace path. */
  workspace: string
  /** Shell commands run inside the OS sandbox (writes confined to the workspace, network asks). */
  sandboxed: boolean
  rules: RuleSet
  /** Anna's own secrets and state; never reachable by tools. */
  protectedPaths: string[]
  /** Scratch folders treated like the workspace (default: the OS temp directory). */
  tempDirs?: string[]
  platform?: NodeJS.Platform
  home?: string
}

export type Decision
  = | { kind: 'allow', note?: string }
    | { kind: 'deny', reason: string }
    | {
      kind: 'ask'
      reason: string
      details: string
      danger: boolean
      /** Rule that "always allow" would add; absent for high-risk calls and for calls a rule cannot describe. */
      rule?: string
      commandClass?: CommandClass
    }

/** Why Anna's own keys and data are refused, whatever the mode or rules. */
const annaData = 'Anna 自己的密钥与数据，任何模式和规则都不能读取或修改。'
const readTools = new Set(['read', 'ls', 'grep', 'find'])
const writeTools = new Set(['write', 'edit'])
const shellTools = new Set(['bash', 'powershell'])

/** Anna's own data, each root listed as written and as resolved, so a symlink cannot route around it. */
function zones(context: PolicyContext) {
  const platform = context.platform ?? process.platform
  const home = context.home ?? homedir()
  const anna = withRealPaths(context.protectedPaths)
  const inside = (root: string, path: string) => isInside(root, path, platform)
  return {
    platform,
    options: { home, platform },
    anna: (paths: string[]) => anna.some(root => paths.some(path => inside(root, path) || globMayReach(path, root, platform))),
    /** Searching `paths` would walk into Anna's data. */
    annaUnder: (paths: string[]) => anna.some(root => paths.some(path => inside(path, root))),
    workspaceOrTemp: (paths: string[]) => [context.workspace, ...(context.tempDirs ?? [canonical(tmpdir())])].some(root => inside(root, paths.at(-1)!)),
  }
}

/** How a path appears on an approval card: relative inside the workspace, absolute outside. */
function shown(path: string, context: PolicyContext) {
  return isInside(context.workspace, path, context.platform) ? relative(context.workspace, path) || '.' : path
}

/** The folder an "always allow" read rule covers: the folder itself, or the one holding the file. */
function folderOf(path: string) {
  try { return statSync(path).isDirectory() ? path : dirname(path) }
  catch { return dirname(path) }
}

/** Secret files a call would read that no rule naming the file allows yet. */
function unapproved(files: string[], context: PolicyContext) {
  const zone = zones(context)
  return files.filter(file => evaluateRules(context.rules, 'Read', spellings(file), context.workspace, { ...zone.options, within: file }) !== 'allow')
}

function secretAsk(reason: string, files: string[], details: string, context: PolicyContext, commandClass?: CommandClass): Decision {
  const names = files.map(file => shown(file, context))
  return { kind: 'ask', reason, details: `${details}\n会读到：${names.join('、')}`, danger: false, rule: files.length === 1 ? pathRule('Read', canonical(files[0]!), context.workspace) : undefined, commandClass }
}

function judgeRead(path: string, context: PolicyContext, folder: boolean, reach?: SearchReach): Decision {
  const zone = zones(context)
  const paths = spellings(path)
  const real = paths.at(-1)!
  if (zone.anna(paths) || (reach && zone.annaUnder(paths)))
    return { kind: 'deny', reason: reach ? '搜索范围包含 Anna 自己的密钥与数据，任何模式和规则都不能读取。请缩小搜索范围。' : `这是${annaData}` }
  const ruled = evaluateRules(context.rules, 'Read', paths, context.workspace, zone.options)
  if (ruled === 'deny')
    return { kind: 'deny', reason: '你的权限规则禁止读取这个位置。' }
  const where = shown(path, context)
  const secrets = unapproved(paths.some(isSecretFile) ? [path] : reach ? secretsIn(real, reach) : [], context)
  if (secrets.length)
    return secretAsk(reach ? '搜索会读到可能含有密钥的文件，内容会发送给模型' : '读取可能含有密钥的文件，内容会发送给模型', secrets, where, context)
  if (ruled === 'ask')
    return { kind: 'ask', reason: '你的规则要求读取这里之前先确认', details: where, danger: false }
  if (ruled === 'allow' || zone.workspaceOrTemp(paths) || context.mode === 'auto')
    return { kind: 'allow' }
  return { kind: 'ask', reason: '读取工作文件夹之外的内容，内容会发送给模型', details: path, danger: false, rule: pathRule('Read', folder ? path : dirname(path), context.workspace, true) }
}

function judgeWrite(path: string, context: PolicyContext): Decision {
  const zone = zones(context)
  const paths = spellings(path)
  const real = paths.at(-1)!
  if (zone.anna(paths))
    return { kind: 'deny', reason: `这是${annaData}` }
  if (context.mode === 'plan')
    return { kind: 'deny', reason: '现在是规划模式，只能查看、不能修改。请先给出方案，等用户切换模式后再动手。' }
  // As in Claude Code, a Read deny rule also blocks writing the same path.
  const ruled = evaluateRules(context.rules, 'Edit', paths, context.workspace, zone.options)
  if (ruled === 'deny' || evaluateRules(context.rules, 'Read', paths, context.workspace, zone.options) === 'deny')
    return { kind: 'deny', reason: '你的权限规则禁止修改这个位置。' }
  if (!isInside(context.workspace, real, zone.platform))
    return ruled === 'allow' ? { kind: 'allow' } : { kind: 'ask', reason: '修改工作文件夹之外的文件', details: path, danger: true }
  if (ruled === 'ask')
    return { kind: 'ask', reason: '你的规则要求修改这里之前先确认', details: shown(real, context), danger: false }
  if (ruled === 'allow' || context.mode === 'edit' || context.mode === 'auto')
    return { kind: 'allow' }
  return { kind: 'ask', reason: '修改文件', details: shown(real, context), danger: false, rule: pathRule('Edit', real, context.workspace) }
}

interface Piece {
  text: string
  /** Every path-like argument, as requested and as resolved, relative to the directory the shell is in by then. */
  paths: string[][]
  /** Prints names or sizes, never contents (`ls`, `find`, `stat` …), so secret file names alone are harmless. */
  metadata: boolean
  search?: { dirs: string[][], reach: SearchScope }
}

/**
 * The paths each simple command touches. `cd` moves the base for the parts after it, so `cd ~/.local/config &&
 * cat ssh/config` is judged as reading `~/.local/config/ssh/config`. Words with variables other than $HOME, and
 * anything inside substitutions, cannot be resolved here; for those the sandbox is the boundary.
 */
function analyze(command: string, context: PolicyContext) {
  const platform = context.platform ?? process.platform
  const home = context.home ?? homedir()
  const parts = segments(command)
  let cwd = context.workspace
  const resolveWord = (word: string, base: string) => spellings(resolveToolPath(word.replace(/^\$HOME(?=\/|$)/, '~'), base, platform, home))
  const pieces: Piece[] = (parts ?? looseParts(command)).map((text) => {
    const words = shellWords(stripWrappers(text))
    const paths: string[][] = []
    words.forEach((word, index) => {
      let value = word.replace(/^\d?[<>]+&?/, '')
      if (value.startsWith('-')) {
        const option = /^-[\w-]+=(.*)$/s.exec(value)
        if (!option || /^--?(?:include|exclude|exclude-dir|glob|iglob|g)=/.test(value))
          return
        value = option[1]!
      }
      if (!value || (index === 0 && !value.includes('/')) || /^[<>|&;()]+$/.test(value) || /^[a-z][\w+.-]*:\/\//i.test(value) || /^\/dev\/(?:null|stdout|stderr|tty)$/.test(value) || /\$(?!HOME(?:\/|$))/.test(value))
        return
      paths.push(resolveWord(value, cwd))
    })
    const scope = searchScope(stripWrappers(text))
    const piece: Piece = { text, paths, metadata: /^(?:ls|find|fd|tree|du|stat|file|wc|realpath|basename|dirname|test)$/.test(words[0] ?? ''), search: scope && { dirs: scope.targets.filter(target => !target.includes('$')).map(target => resolveWord(target, cwd)), reach: scope } }
    if (words[0] === 'cd' || words[0] === 'pushd') {
      const target = words.slice(1).find(word => !word.startsWith('-'))
      if (target !== '-')
        cwd = resolveWord(target ?? '~', cwd).at(-1)!
    }
    return piece
  })
  return { parts, pieces }
}

function judgeCommand(command: string, context: PolicyContext): Decision {
  const zone = zones(context)
  const { pieces } = analyze(command, context)
  const paths = pieces.flatMap(piece => piece.paths)
  const searches = pieces.flatMap(piece => piece.search ? piece.search.dirs.map(dir => ({ dir, reach: piece.search!.reach })) : [])
  if (paths.some(zone.anna) || searches.some(search => zone.annaUnder(search.dir)))
    return { kind: 'deny', reason: `命令涉及${annaData}` }
  const bash = evaluateRules(context.rules, 'Bash', command, context.workspace, zone.options)
  if (bash === 'deny')
    return { kind: 'deny', reason: '你的权限规则禁止这条命令。' }
  if (paths.some(path => evaluateRules(context.rules, 'Read', path, context.workspace, zone.options) === 'deny'))
    return { kind: 'deny', reason: '你的权限规则禁止读取命令涉及的位置。' }
  const kind = classify(command)
  const details = command.slice(0, 1200)
  if (kind === 'danger')
    return context.mode === 'plan' ? { kind: 'deny', reason: '规划模式下不执行高风险命令。' } : { kind: 'ask', reason: '这条命令可能造成难以撤销的影响', details, danger: true, commandClass: kind }
  if (context.mode === 'plan' && kind !== 'inspect')
    return { kind: 'deny', reason: '现在是规划模式，只运行查看类命令。请先给出方案，等用户切换模式后再执行。' }

  // Secret files: the same check whether the command names them or a recursive search would read them.
  const named = pieces.filter(piece => !piece.metadata).flatMap(piece => piece.paths).filter(path => path.some(isSecretFile)).map(path => path[0]!)
  const secrets = unapproved([...new Set([...named, ...searches.flatMap(search => secretsIn(search.dir.at(-1)!, search.reach))])], context)
  if (secrets.length)
    return secretAsk('命令会读取可能含有密钥的文件，内容会发送给模型', secrets, details, context, kind)

  if (bash === 'ask')
    return { kind: 'ask', reason: '你的规则要求这条命令先确认', details, danger: false, commandClass: kind }
  // Claude Code's semantics: a compound command is covered only part by part; read-only parts need no rule.
  const uncovered = uncoveredParts(context.rules, command)
  const open = uncovered ? pieces.filter(piece => uncovered.includes(piece.text)) : pieces
  const parts = segments(command.trim()) ?? []
  const rest = uncovered ? uncovered.map(part => classifyIn(parts, part)).reduce<CommandClass>((worst, next) => commandRank[next] > commandRank[worst] ? next : worst, 'inspect') : kind
  const outside = [...open.flatMap(piece => piece.paths), ...open.flatMap(piece => piece.search?.dirs ?? [])].filter(path => !zone.workspaceOrTemp(path) && evaluateRules(context.rules, 'Read', path, context.workspace, zone.options) !== 'allow')
  const needed = uncovered?.filter(part => classifyIn(parts, part) !== 'inspect') ?? []
  const commandRuleFor = needed.length === 1 ? commandRule(needed[0]!) : undefined
  const folders = [...new Set(outside.map(path => folderOf(path[0]!)))]
  const readRule = folders.length === 1 ? pathRule('Read', folders[0]!, context.workspace, true) : undefined
  const ask = (reason: string, rule = commandRuleFor): Decision => ({ kind: 'ask', reason, details, danger: false, rule, commandClass: rest })

  if (outside.length && rest === 'inspect' && context.mode !== 'auto')
    return ask('查看工作文件夹之外的内容', readRule)
  if (rest === 'inspect')
    return { kind: 'allow' }
  if (outside.length && !context.sandboxed)
    return { kind: 'ask', reason: '命令涉及工作文件夹之外的路径', details, danger: true, commandClass: rest }
  // Plan never gets here: it returned above for anything but inspect commands.
  if (context.mode === 'auto') {
    if (context.sandboxed)
      return { kind: 'allow', note: '沙箱' }
    return rest === 'verify' ? { kind: 'allow' } : ask('这台电脑没有可用的沙箱，命令需要确认')
  }
  if (context.mode === 'edit' && rest === 'verify')
    return { kind: 'allow' }
  return ask(rest === 'network' ? '运行需要联网的命令' : '运行命令')
}

/** Decide one tool call. Pure apart from reading the file system (symlinks, folders, `.gitignore`). */
export function decide(tool: string, input: Record<string, unknown>, context: PolicyContext): Decision {
  const platform = context.platform ?? process.platform
  const target = (value: unknown) => resolveToolPath(typeof value === 'string' && value ? value : '.', context.workspace, platform, context.home)
  if (readTools.has(tool)) {
    // pi's grep tool runs ripgrep with --hidden and honours .gitignore.
    const reach = tool === 'grep' ? { hidden: true, ignored: false, include: typeof input.glob === 'string' && input.glob ? [input.glob] : [], exclude: [] } : undefined
    return judgeRead(target(input.path), context, tool !== 'read', reach)
  }
  if (writeTools.has(tool))
    return judgeWrite(target(input.path), context)
  if (shellTools.has(tool))
    return judgeCommand(String(input.command ?? ''), context)
  if (tool.startsWith('anna_'))
    return { kind: 'allow' }
  return context.mode === 'auto' ? { kind: 'allow' } : { kind: 'ask', reason: `调用工具 ${tool}`, details: JSON.stringify(input).slice(0, 1200), danger: false, rule: undefined }
}

export function describeMode(mode: PermissionMode) { return modes[mode] }
