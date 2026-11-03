import type { AgentDescriptor } from './catalog'

/** Official entry points. Commands are shown for review and never executed by this panel. */
export function installationGuide(agent: AgentDescriptor, platform: string) {
  const docs: Record<string, string> = {
    'claude': 'https://code.claude.com/docs/en/setup',
    'codex': 'https://learn.chatgpt.com/docs/codex/cli',
    'workbuddy': 'https://www.codebuddy.cn/work/',
    'qoder-cn': 'https://docs.qoder.cn/cli/installation',
    'trae': 'https://docs.trae.cn/cli_get-started-with-trae-cli-2',
    'hermes': 'https://hermes-agent.nousresearch.com/docs/getting-started/installation',
    'goose': 'https://block.github.io/goose/',
    'claude-desktop': 'https://claude.com/download',
  }
  const npm = /^npm i(?:nstall)? -g (\S+)/.exec(agent.install ?? '')?.[1]
  const packageName = npm?.replace(/@[^/@]+$/, '')
  const url = docs[agent.id] ?? (packageName ? `https://www.npmjs.com/package/${packageName}` : /https:\/\/[^\s|"']+/.exec(agent.install ?? '')?.[0])
  let command = agent.install
  if (agent.id === 'claude')
    command = platform === 'win32' ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash'
  if (agent.id === 'qoder-cn')
    command = platform === 'win32' ? 'irm https://static.qoder.com.cn/qoder-cli-cn/install.ps1 | iex' : 'curl -fsSL https://static.qoder.com.cn/qoder-cli-cn/install.sh | bash'
  if (agent.id === 'trae')
    command = platform === 'win32' ? 'irm https://trae.cn/trae-cli/install_v2.ps1 | iex' : 'sh -c "$(curl -fsSL https://trae.cn/trae-cli/install_v2.sh)"'
  if (platform === 'win32' && command && /\b(?:curl|bash|sh)\b/.test(command))
    command = undefined
  return { url, command, needsNode: Boolean(command?.startsWith('npm ')), terminal: platform === 'win32' ? 'Windows PowerShell' : platform === 'darwin' ? 'macOS 终端' : '系统终端' }
}
