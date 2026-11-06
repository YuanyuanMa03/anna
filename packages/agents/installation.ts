import type { AgentDescriptor } from './catalog'
import { autoInstallable } from './catalog'

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

/**
 * The same guide as numbered steps for someone who has never opened a terminal: how to open it on this system, what to
 * paste, and what to do once it is installed. `oneClick` says the app can run the install itself (an npm package).
 */
export function installSteps(agent: AgentDescriptor, platform: string) {
  const guide = installationGuide(agent, platform)
  const windows = platform === 'win32'
  const open = windows
    ? '按键盘上的 Windows 键，输入 PowerShell，打开“Windows PowerShell”。'
    : platform === 'darwin' ? '按 ⌘ + 空格，输入“终端”，按回车打开“终端”。' : '从应用菜单打开“终端”。'
  const steps = guide.command
    ? [
        ...(guide.needsNode ? ['这条命令需要电脑上先有 Node.js：没装过的话，先从 nodejs.org 下载安装 LTS 版本，一路点“下一步”即可。'] : []),
        open,
        '点下面的“复制命令”，在窗口里粘贴（Windows 右键即可粘贴，Mac 按 ⌘ + V），按回车。',
        '等它跑完（可能要一两分钟），看到命令提示符重新出现就是装好了。窗口里出现红字时，把那几行截图保存下来。',
        '回到 Anna，点“我已安装，重新检测”。',
      ]
    : [
        `打开 ${agent.label} 的官方页面，下载适合${windows ? ' Windows ' : platform === 'darwin' ? ' Mac ' : '这台电脑'}的安装包。`,
        '像安装普通软件一样双击安装，按提示完成。',
        '回到 Anna，点“我已安装，重新检测”。',
      ]
  const after = agent.id === 'claude' || agent.id === 'codex'
    ? `装好后不一定要登录官方账号：在“接通模型”里选“其他模型厂商 API”，填上任意一家的 API Key 就能用。想用官方账号的话，在${windows ? ' PowerShell ' : '终端'}里输入 ${agent.binaries[0]} 按提示登录。`
    : `装好后按 ${agent.label} 自己的说明登录或配置模型；Anna 会用它保存的配置。`
  return { ...guide, steps, after, oneClick: Boolean(agent.install && autoInstallable(agent.install)) }
}
