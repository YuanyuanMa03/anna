// Main-process only: it reads files to unwrap Windows shims, so the renderer must not import it.
import { posix, win32 } from 'node:path'
import { autoInstallable } from './catalog'
import { scriptLaunch } from './windows-shim'

/**
 * How to run an agent's `npm i -g` install with an argument list: npm is looked up the way agents are (a GUI app does not
 * inherit the shell's PATH), and on Windows its .cmd is started without a shell. Throws a message for the person otherwise.
 */
export function installLaunch(install: string, platform: NodeJS.Platform, find: (name: string) => string | undefined, deps?: Parameters<typeof scriptLaunch>[2]): { command: string, args: string[], verbatim?: true, bin: string } {
  if (!autoInstallable(install))
    throw new Error(`请在终端里运行：${install}`)
  const [, ...args] = install.split(' ')
  const npm = find('npm')
  if (!npm)
    throw new Error('没有找到 npm：请先从 https://nodejs.org 安装 Node.js，再重试')
  const launch = platform === 'win32' ? scriptLaunch(npm, args, deps) : { command: npm, args }
  if (!launch)
    throw new Error(`请在终端里运行：${install}`)
  // npm and the scripts it runs look for `node` on the path, and nvm or fnm keep it beside npm.
  return { ...launch, bin: (platform === 'win32' ? win32 : posix).dirname(npm) }
}
