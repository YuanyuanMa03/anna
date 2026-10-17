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
  [/^(?:ls|pwd|cat|head|tail|wc|file|stat|du|df|which|whoami|date|uname|basename|dirname|realpath|true|false|nl|less|more)\b/],
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
  /^(?:cargo\s+(?:test|check|build|clippy|fmt\s+--check)|go\s+(?:test|vet|build))\b/,
  /^(?:make|just)\s+(?:test|check|lint|build)\b/,
  /^dotnet\s+(?:test|build)\b/,
]

/** Split on control operators; undefined when the line uses constructs we will not reason about. */
export function segments(command: string): string[] | undefined {
  const text = command.trim()
  if (!text)
    return undefined
  const cleaned = text.replace(/\s\d?>\s*\/dev\/null|\s2>&1|\s\d?>\s*\$null/g, ' ')
  if (/\$\(|`|<\(|>\(|[<>]|\$\{|\\\n/.test(cleaned))
    return undefined
  if (/(?:^|\s)[A-Z_]\w*=/i.test(cleaned) || /(?:^|[;&|]\s*)(?:xargs|eval|exec|source|\.|env|nohup|time|watch|tee|sh|bash|zsh|fish|pwsh|powershell|cmd|python3?\s+-c|node\s+-e|perl|ruby\s+-e)\b/.test(cleaned))
    return undefined
  return cleaned.split(/\s*(?:&&|\|\||[;|&\n])\s*/).map(part => part.trim()).filter(Boolean)
}

function inspects(part: string) {
  return inspectors.some(([pattern, unsafe]) => pattern.test(part) && !(unsafe?.test(part)))
}

/** Classify a shell line by its most consequential part. */
export function classify(command: string): CommandClass {
  const text = command.trim()
  if (dangerous.some(pattern => pattern.test(text)))
    return 'danger'
  const parts = segments(text)
  if (!parts)
    return network.some(pattern => pattern.test(text)) ? 'network' : 'change'
  let worst: CommandClass = 'inspect'
  for (const part of parts) {
    const kind: CommandClass = inspects(part) ? 'inspect' : verifiers.some(pattern => pattern.test(part)) ? 'verify' : network.some(pattern => pattern.test(part)) ? 'network' : 'change'
    if (commandRank[kind] > commandRank[worst])
      worst = kind
  }
  return worst
}

/** Rule key used for "allow for this session/workspace": the program and its subcommand, e.g. `pnpm install`. */
export function commandPrefix(command: string) {
  return command.trim().split(/\s+/).slice(0, 2).join(' ')
}

export function isVerification(command: string) {
  const parts = segments(command) ?? [command.trim()]
  return parts.some(part => verifiers.some(pattern => pattern.test(part)))
}
