import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'
import { execFile } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { SandboxManager } from '@anthropic-ai/sandbox-runtime'
import { withRealPaths } from './paths'

export interface SandboxStatus { available: boolean, reason?: string }
export type NetworkAsk = (host: string, port: number | undefined) => Promise<boolean>

/** Package-manager caches commands may write outside the workspace. */
function cacheDirs(home = homedir()) {
  return ['.npm', '.cache', '.pnpm-store', '.local/share/pnpm', 'Library/pnpm', 'Library/Caches', '.yarn', '.bun/install/cache', '.cargo/registry', '.cargo/git', 'go/pkg/mod', '.gradle/caches', '.m2/repository'].map(name => join(home, name))
}

/**
 * The sandbox's file rules, as in Claude Code's default: commands read most of the machine and write only the
 * workspace, temp and package caches. Anna's own data is neither readable nor writable. Every path is listed as written
 * and as resolved: Seatbelt checks the resolved path, so denying only a symlink would leave its target readable.
 */
export function sandboxFilesystem(workspace: string, protectedPaths: string[], home = homedir()): SandboxRuntimeConfig['filesystem'] {
  return {
    denyRead: withRealPaths(protectedPaths),
    allowWrite: withRealPaths([workspace, tmpdir(), '/tmp', ...cacheDirs(home)]),
    denyWrite: withRealPaths(protectedPaths),
  }
}

/**
 * OS-level isolation for shell commands (Seatbelt on macOS, bubblewrap on Linux) via @anthropic-ai/sandbox-runtime,
 * with the file rules above; every network host goes through `askNetwork`. The manager is process-wide, so one Anna
 * runtime owns it at a time.
 */
export class CommandSandbox {
  private started = false
  static async probe(platform: NodeJS.Platform = process.platform): Promise<SandboxStatus> {
    if (process.env.ANNA_DISABLE_SANDBOX === '1')
      return { available: false, reason: '沙箱已通过 ANNA_DISABLE_SANDBOX 关闭' }
    if (platform === 'win32')
      return { available: false, reason: 'Windows 沙箱仍是预览版，需要管理员安装，Anna 暂不启用' }
    if (!SandboxManager.isSupportedPlatform())
      return { available: false, reason: '当前系统不支持命令沙箱' }
    if (platform === 'linux') {
      const check = await SandboxManager.checkDependenciesAsync().catch((error: Error) => ({ errors: [error.message], warnings: [] }))
      if (check.errors.length)
        return { available: false, reason: `缺少沙箱依赖：${check.errors.join('；')}（需要 bubblewrap、socat、ripgrep）` }
    }
    return { available: true }
  }

  async start(workspace: string, protectedPaths: string[], askNetwork: NetworkAsk) {
    await this.stop()
    const config = { network: { allowedDomains: [], deniedDomains: [] }, filesystem: sandboxFilesystem(workspace, protectedPaths) } as SandboxRuntimeConfig
    await SandboxManager.initialize(config, async ({ host, port }) => askNetwork(host, port))
    this.started = true
    // Some systems ship the sandbox tools but forbid them (e.g. Ubuntu's unprivileged user-namespace policy).
    // Prove a trivial command runs before promising isolation.
    const probe = await this.wrap('true', 'anna-sandbox-self-test')
    const ok = await new Promise<boolean>(resolve => execFile(process.platform === 'win32' ? 'cmd' : '/bin/sh', ['-c', probe], { timeout: 15000 }, error => resolve(!error)))
    if (!ok) {
      await this.stop()
      throw new Error('沙箱自检失败（系统可能禁止了用户命名空间或 Seatbelt）')
    }
  }

  async wrap(command: string, commandId: string) {
    if (!this.started)
      throw new Error('命令沙箱尚未启动')
    return SandboxManager.wrapWithSandbox(command, undefined, undefined, undefined, { commandId, commandText: command })
  }

  explain(commandId: string, stderr: string) {
    return SandboxManager.annotateStderrWithSandboxFailures(commandId, stderr)
  }

  async stop() {
    if (this.started)
      await SandboxManager.reset().catch(() => {})
    this.started = false
  }
}
