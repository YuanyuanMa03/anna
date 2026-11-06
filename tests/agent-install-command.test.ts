import { posix, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installLaunch } from '../packages/agents/install-launch'

describe('running an agent\'s npm install', () => {
  it('finds npm on the search path and passes the package as separate arguments', () => {
    const npm = posix.join('/opt/homebrew/bin', 'npm')
    expect(installLaunch('npm i -g @openai/codex@latest', 'darwin', name => name === 'npm' ? npm : undefined)).toEqual({ command: npm, args: ['i', '-g', '@openai/codex@latest'], bin: '/opt/homebrew/bin' })
  })

  it('runs Node\'s npm.cmd on Windows through node and npm-cli.js, never a shell', () => {
    const node = 'C:\\Program Files\\nodejs'
    const files: Record<string, string> = { [win32.join(node, 'npm.cmd')]: '"%NODE_EXE%" "%NPM_CLI_JS%" %*', [win32.join(node, 'node.exe')]: '', [win32.join(node, 'node_modules\\npm\\bin\\npm-cli.js')]: '' }
    const launch = installLaunch('npm i -g @deepseek-ai/dsh@latest --engine-strict', 'win32', name => name === 'npm' ? win32.join(node, 'npm.cmd') : undefined, { read: path => files[path] ?? '', exists: path => path in files, comspec: 'cmd.exe' })
    expect(launch).toEqual({ command: win32.join(node, 'node.exe'), args: [win32.join(node, 'node_modules\\npm\\bin\\npm-cli.js'), 'i', '-g', '@deepseek-ai/dsh@latest', '--engine-strict'], bin: node })
  })

  it('falls back to cmd.exe only for plain arguments, and refuses an npm it cannot start safely', () => {
    const volta = 'C:\\Users\\a b\\.volta\\bin\\npm.cmd'
    const opaque = { read: () => '@echo off\r\nvolta-shim %*', exists: (path: string) => path === volta, comspec: 'cmd.exe' }
    expect(installLaunch('npm i -g @openai/codex@latest', 'win32', () => volta, opaque)).toMatchObject({ command: 'cmd.exe', verbatim: true, bin: 'C:\\Users\\a b\\.volta\\bin' })
    expect(() => installLaunch('npm i -g @openai/codex@latest', 'win32', () => 'C:\\odd%dir\\npm.cmd', { ...opaque, exists: (path: string) => path === 'C:\\odd%dir\\npm.cmd' })).toThrow(/终端/)
  })

  it('explains what is missing instead of guessing', () => {
    expect(() => installLaunch('npm i -g codex', 'win32', () => undefined)).toThrow(/Node\.js/)
    expect(() => installLaunch('curl -fsSL https://x | sh', 'darwin', () => '/usr/bin/curl')).toThrow(/终端/)
  })
})
