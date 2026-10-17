import process from 'node:process'

/**
 * Command classes, from least to most consequential.
 * - inspect: only reads (ls, git status, rg …)
 * - verify: builds or runs the project's own checks (tests, lint, typecheck); executes project code
 * - change: anything else that may write files or start programs
 * - network: fetches or publishes (installs, clones, curl); also a change
 * - danger: hard to undo (rm -rf, git push, sudo …)
 * The class only reduces prompts. The sandbox, not this parser, is the security boundary.
 */
export type CommandClass = 'inspect' | 'verify' | 'change' | 'network' | 'danger'
export const commandRank: Record<CommandClass, number> = { inspect: 0, verify: 1, change: 2, network: 3, danger: 4 }

const dangerous = [
  /\brm\s+-\S*[rf]/i,
  /\b(?:sudo|su|doas)\b/,
  /\bgit\s+(?:push|reset\s+--hard|clean|rebase|filter-branch|filter-repo|checkout\s+--|restore\b|branch\s+-[dDmMcCf]\b|branch\s+--(?:delete|force|move))/,
  /\bgit\s+(?:tag|stash)\s+(?:-d|--delete|drop|clear)\b/,
  /\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|]*\|\s*(?:ba|z|fi)?sh\b/i,
  /\b(?:curl|wget|iwr|irm)\b[^|]*\|\s*(?:iex|Invoke-Expression)\b/i,
  /\bchmod\s+(?:-R|777)|\bchown\b/,
  /\bmkfs\b|\bdd\s+if=|\bdiskutil\s+(?:erase|partition)|\bformat-volume\b/i,
  /\b(?:shutdown|reboot|halt|killall|pkill)\b|\bkill\s+-9\b|\bStop-Computer\b|\bRestart-Computer\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b/,
  /\bdocker\s+(?:rm|rmi|system\s+prune|volume\s+rm)\b/,
  /\bRemove-Item\b.*-Recurse|\brd\s+\/s\b|\bdel\s+\/[sq]\b/i,
  /\bcrontab\s+-r\b|\blaunchctl\s+(?:unload|remove|bootout)\b/,
]
const network = [
  /^(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|ci|update|up|upgrade|dlx|create|x)\b/,
  /^(?:npx|bunx|pnpx)\b(?!\s+(?:vitest|tsc|eslint|vue-tsc|prettier))/,
  /^(?:pip3?|uv|poetry|pipx|conda)\s+(?:install|add|sync|lock|update)\b/,
  /^(?:cargo\s+(?:add|install|update|fetch)|go\s+(?:get|install|mod\s+download))\b/,
  /^(?:brew|apt|apt-get|dnf|yum|pacman|winget|choco|scoop)\b/,
  /^git\s+(?:clone|fetch|pull|submodule\s+update|ls-remote)\b/,
  /^(?:curl|wget|ssh|scp|rsync|ftp|nc|telnet|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i,
]

/** Inspect commands: [pattern, flags that turn the command into a writer or executor]. */
const inspectors: [RegExp, RegExp?][] = [
  [/^(?:ls|pwd|cd|pushd|popd|cat|head|tail|wc|file|stat|du|df|which|whoami|date|uname|basename|dirname|realpath|true|false|nl|less|more)\b/],
  [/^(?:echo|printf)\b/],
  [/^tree\b/, /\s-o\b|--output/],
  [/^diff\b/, /--output|--to-file|--from-file/],
  [/^(?:rg|grep|egrep|fgrep|ag)\b/, /--pre\b|--pre-glob|--(?:search-)?zip\b|\s-z\b/],
  [/^find\b/, /\s-(?:exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)\b/],
  [/^sort\b/, /\s(?:-o|--output)\b|\s(?:-\S+\s+)*[^-\s]/],
  [/^uniq\b/, /\s[^-\s]\S*\s+[^-\s]/],
  [/^cut\b|^tr\b|^column\b|^jq\b|^yq\b/],
  [/^sed\s+-n\b/, /\s-i\b|--in-place|(?:^|[\s"'/;}\d])[wWe](?:[\s"']|$)/],
  [/^git\s+(?:status|log|show|diff|rev-parse|ls-files|ls-tree|blame|describe|shortlog|reflog|cat-file|grep|config\s+--get|remote(?:\s+-v)?$|remote\s+(?:show|get-url)|stash\s+list|branch(?:\s+(?:-a|-r|-v|-vv|--list|--show-current|--contains|--merged))*\s*$|tag(?:\s+(?:-l|--list))?\s*$)(?:\s|$)/, /--output|--ext-diff|\s-c\s|--upload-pack|--exec/],
  [/^(?:node|python3?|ruby|go|cargo|rustc|java|deno|bun|pnpm|npm|yarn|tsc|uv|git)\s+(?:-v|-V|--version|version)\s*$/],
  [/^(?:Get-ChildItem|gci|dir|Get-Content|gc|type|Get-Location|gl|Select-String|sls|Get-Item|gi|Test-Path|Resolve-Path|Measure-Object|Get-Command|Write-Output|Write-Host)\b/i],
]
const verifiers = [
  /^(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|tests|lint|typecheck|type-check|check|build|vitest|tsc|eslint|format:check)(?::\S+)?\b/,
  /^(?:pnpm|npx|bunx|yarn)\s+(?:exec\s+)?(?:vitest|tsc|eslint|vue-tsc|jest|prettier\s+--check)\b/,
  /^(?:vitest|jest|pytest|tsc|vue-tsc|eslint|ruff|mypy|pyright|swift\s+test|xcodebuild\s+test)\b/,
  /^python3?\s+-m\s+(?:pytest|unittest|mypy|ruff|compileall)\b/,
  /^(?:node\s+--test|deno\s+test|bun\s+test)\b/,
  /^(?:cargo\s+(?:test|check|build|clippy|fmt\s+--check)|go\s+(?:test|vet|build))\b/,
  /^(?:make|just)\s+(?:test|check|lint|build)\b/,
  /^dotnet\s+(?:test|build)\b/,
]

const opaque = /^(?:xargs|eval|exec|source|\.|env|nohup|time|timeout|nice|watch|tee|sh|bash|zsh|fish|dash|pwsh|powershell|cmd|python3?\s+-c|node\s+(?:-e|-p|--eval|--print)|bun\s+-e|deno\s+eval|perl|ruby\s+-e)(?:\s|$)/

/**
 * Split a shell line into simple commands on `&&`, `||`, `;`, `|`, `|&`, `&` and newlines, honouring quotes.
 * Undefined when the line uses constructs we will not reason about: substitutions, redirections, subshells,
 * variable assignments, wrappers that run their arguments, a dangling operator or an unclosed quote.
 * Like Claude Code, an unparseable line never matches an allow rule and is never read-only.
 */
export function segments(command: string): string[] | undefined {
  const text = command.trim().replace(/\s\d?>\s*\/dev\/null|\s2>&1|\s\d?>\s*\$null/g, ' ')
  if (!text || text.length > 10000)
    return undefined
  const parts: string[] = []
  let current = ''
  let quote: '' | '\'' | '"' = ''
  let operator = ''
  const cut = (op: string) => {
    if (!current.trim() && op !== '\n')
      return false
    if (current.trim())
      parts.push(current.trim())
    current = ''
    operator = op
    return true
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    const next = text[index + 1]
    if (quote === '\'') {
      if (char === '\'')
        quote = ''
      current += char
      continue
    }
    if (char === '\\') {
      if (next === undefined || next === '\n')
        return undefined
      current += char + next
      index++
      continue
    }
    if (char === '`' || (char === '$' && (next === '(' || next === '{')))
      return undefined
    if (quote === '"') {
      if (char === '"')
        quote = ''
      current += char
      continue
    }
    if (char === '\'' || char === '"') {
      quote = char
      current += char
      continue
    }
    if ('<>(){}'.includes(char))
      return undefined
    const pair = char + (next ?? '')
    if (pair === '&&' || pair === '||' || pair === '|&') {
      if (!cut(pair))
        return undefined
      index++
    }
    else if (char === '|' || char === ';' || char === '&' || char === '\n') {
      if (!cut(char))
        return undefined
    }
    else {
      current += char
      if (char.trim())
        operator = ''
    }
  }
  if (quote || ['&&', '||', '|', '|&'].includes(operator))
    return undefined
  if (current.trim())
    parts.push(current.trim())
  if (!parts.length || parts.some(part => /^[A-Z_]\w*=/i.test(part) || opaque.test(part)))
    return undefined
  return parts
}

/** A conservative split for lines `segments` rejects: deny and ask rules still match any piece of them. */
export function looseParts(command: string) {
  return command.split(/&&|\|\||\|&|[;|&\n`(){}]|\$\(|<\(|>\(/).map(part => part.trim().replace(/^['"]+|['"]+$/g, '').trim()).filter(Boolean)
}

/** Leading assignments and wrappers that run their argument (`timeout 30`, `nice`, `nohup`, bare `xargs`). */
export function stripWrappers(part: string) {
  let text = part.trim()
  for (let previous = ''; previous !== text;) {
    previous = text
    text = text.replace(/^[A-Z_]\w*=(?:"[^"]*"|'[^']*'|\S)*\s+/i, '').replace(/^(?:timeout\s+(?:-\S+\s+)*\S+|nice(?:\s+-n\s*\S+|\s+-\d+)?|nohup|time|command(?!\s+-[vV])|builtin|noglob|stdbuf(?:\s+-\S+)*|xargs)\s+/, '')
  }
  return text
}

/**
 * Shell words with quotes removed: `grep -r "a b" src` → grep, -r, a b, src. On Windows the shell is PowerShell,
 * where a backslash is a path separator rather than an escape, so `C:\Users\a` stays one word.
 */
export function shellWords(part: string, platform: NodeJS.Platform = process.platform) {
  if (platform === 'win32')
    return (part.match(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g) ?? []).map(word => word.replace(/"([^"]*)"|'([^']*)'/g, '$1$2'))
  return (part.match(/(?:"[^"]*"|'[^']*'|\\.|[^\s"'\\])+/g) ?? []).map(word => word.replace(/"([^"]*)"|'([^']*)'|\\(.)/g, '$1$2$3'))
}

/** A part that expands a variable other than $HOME cannot be judged from its text. */
function expandsVariables(part: string) {
  return /\$(?!HOME\b)[\w@*#?$!-]/.test(part.replace(/'[^']*'/g, ''))
}

function inspects(part: string) {
  return !expandsVariables(part) && inspectors.some(([pattern, unsafe]) => pattern.test(part) && !(unsafe?.test(part)))
}

function kindOf(part: string): CommandClass {
  return inspects(part) ? 'inspect' : verifiers.some(pattern => pattern.test(part)) ? 'verify' : network.some(pattern => pattern.test(part)) ? 'network' : 'change'
}

/** Classify one simple command (a part from `segments`). */
export function classifyPart(part: string): CommandClass {
  return dangerous.some(pattern => pattern.test(part)) ? 'danger' : kindOf(part)
}

/**
 * Classify one part as it runs inside its whole command line. As in Claude Code, git after a `cd` runs that
 * directory's hooks and config, so it is not read-only there.
 */
export function classifyIn(parts: string[], part: string): CommandClass {
  const kind = classifyPart(part)
  return kind === 'inspect' && /^git\s/.test(part) && parts.some(other => /^(?:cd|pushd)\s/.test(other)) ? 'change' : kind
}

/** Classify a shell line by its most consequential part. */
export function classify(command: string): CommandClass {
  const text = command.trim()
  if (dangerous.some(pattern => pattern.test(text)))
    return 'danger'
  const parts = segments(text)
  if (!parts)
    return network.some(pattern => pattern.test(text)) ? 'network' : 'change'
  return parts.map(part => classifyIn(parts, part)).reduce<CommandClass>((worst, next) => commandRank[next] > commandRank[worst] ? next : worst, 'inspect')
}

/**
 * The rule "always allow" offers for one simple command, in Claude Code's form: the program and its subcommand
 * followed by ` *` (`Bash(pnpm install *)`). Undefined when the second word is a flag or a quoted argument, since a
 * rule like `Bash(git *)` or `Bash(printf 'Delegated:*)` would allow far more than the card showed.
 */
export function commandRule(part: string) {
  const words = part.trim().split(/\s+/)
  const [program, sub] = words
  if (!program || !/^[\w@.+/-]+$/.test(program))
    return undefined
  if (sub === undefined)
    return `Bash(${program})`
  return /^[a-z][\w.:@/+-]*$/i.test(sub) ? `Bash(${program} ${sub} *)` : undefined
}

export function isVerification(command: string) {
  const parts = segments(command) ?? [command.trim()]
  return parts.some(part => verifiers.some(pattern => pattern.test(part)))
}

/** What a content search reads: the folders it walks and whether it skips hidden and ignored files. */
export interface SearchScope { targets: string[], hidden: boolean, ignored: boolean, include: string[], exclude: string[] }

const valueFlags: Record<string, { short: string, long: string[] }> = {
  grep: { short: 'efmABCdD', long: ['regexp', 'file', 'max-count', 'after-context', 'before-context', 'context', 'directories', 'devices', 'include', 'exclude', 'exclude-dir', 'exclude-from', 'label', 'color', 'colour', 'binary-files'] },
  rg: { short: 'efgtTmABCjMEdr', long: ['regexp', 'file', 'glob', 'iglob', 'type', 'type-not', 'max-count', 'after-context', 'before-context', 'context', 'threads', 'max-columns', 'encoding', 'replace', 'max-depth', 'sort', 'sortr', 'type-add', 'ignore-file', 'max-filesize', 'path-separator', 'color', 'colors', 'context-separator', 'field-match-separator', 'pre', 'pre-glob'] },
  ag: { short: 'GgmABCp', long: ['file-search-regex', 'max-count', 'after', 'before', 'context', 'path-to-ignore', 'depth', 'ignore', 'ignore-dir'] },
  git: { short: 'efABCm', long: ['max-depth', 'after-context', 'before-context', 'context', 'max-count', 'threads'] },
}

/**
 * A recursive content search in one simple command: `grep -r`, `rg`, `ag` or `git grep`. Undefined for anything
 * else (including `grep` on named files, whose paths are checked directly).
 */
export function searchScope(part: string, platform: NodeJS.Platform = process.platform): SearchScope | undefined {
  const words = shellWords(part, platform)
  const tool = words[0] === 'egrep' || words[0] === 'fgrep' ? 'grep' : words[0]
  if (tool === 'git') {
    if (words[1] !== 'grep')
      return undefined
    words.splice(0, 1)
  }
  if (!tool || !(tool in valueFlags))
    return undefined
  const spec = valueFlags[tool === 'git' ? 'git' : tool]!
  const scope: SearchScope = { targets: [], hidden: tool === 'grep' || tool === 'git', ignored: tool === 'grep', include: [], exclude: [] }
  let recursive = tool !== 'grep'
  let pattern = false
  let unrestricted = 0
  const positional: string[] = []
  const option = (name: string, value: string | undefined) => {
    if (name === 'e' || name === 'f' || name === 'regexp' || name === 'file')
      pattern = true
    if (name === 'include' || ((name === 'g' || name === 'glob' || name === 'iglob') && !value?.startsWith('!')))
      scope.include.push(value ?? '')
    if (name === 'exclude' || ((name === 'g' || name === 'glob' || name === 'iglob') && value?.startsWith('!')))
      scope.exclude.push(value?.replace(/^!/, '') ?? '')
    if ((name === 'd' && tool === 'grep') || name === 'directories')
      recursive ||= value === 'recurse'
  }
  for (let index = 1; index < words.length; index++) {
    const word = words[index]!
    if (word === '--') {
      positional.push(...words.slice(index + 1))
      break
    }
    if (word.startsWith('--')) {
      const [name, value] = word.slice(2).split(/=(.*)/s) as [string, string | undefined]
      const takes = spec.long.includes(name) && value === undefined
      option(name, takes ? words[++index] : value)
      if (name === 'recursive' || name === 'dereference-recursive')
        recursive = true
      if (name === 'hidden' || name === 'all-hidden')
        scope.hidden = true
      if (name === 'no-ignore' || name === 'no-ignore-vcs' || name === 'skip-vcs-ignores' || name === 'untracked' || name === 'no-index')
        scope.ignored = true
      if (name === 'unrestricted')
        unrestricted++
      if (name === 'files' && tool === 'rg')
        return undefined
      continue
    }
    if (word.startsWith('-') && word.length > 1) {
      for (let at = 1; at < word.length; at++) {
        const flag = word[at]!
        if (spec.short.includes(flag)) {
          option(flag, at + 1 < word.length ? word.slice(at + 1) : words[++index])
          break
        }
        if (flag === 'r' || flag === 'R')
          recursive = true
        if (flag === 'u')
          unrestricted++
        if (flag === '.' && tool === 'rg')
          scope.hidden = true
        if (flag === 'U' && tool === 'ag')
          scope.ignored = true
      }
      continue
    }
    positional.push(word)
  }
  if (!recursive)
    return undefined
  if (tool === 'ag' && unrestricted)
    unrestricted = 2
  if (unrestricted >= 1)
    scope.ignored = true
  if (unrestricted >= 2)
    scope.hidden = true
  scope.targets = pattern ? positional : positional.slice(1)
  if (!scope.targets.length)
    scope.targets = ['.']
  return scope
}
