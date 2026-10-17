import type { UpdatePlan } from '../../packages/shared/update'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { app } from 'electron'
import { planUpdate, swapScript, verifyDigest } from '../../packages/shared/update'

const run = promisify(execFile)
export interface UpdateState { state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'current', version?: string, notes?: string, message?: string }

/**
 * In-app updates for the unsigned distribution: the manifest and archive are fetched by Node (no quarantine flag),
 * verified against the published SHA-256, unpacked next to the app, and swapped in by a detached script after quit.
 */
export class Updater {
  private plan?: UpdatePlan
  state: UpdateState = { state: 'idle' }
  constructor(private base: string, private publish: (state: UpdateState) => void) {}

  private set(state: UpdateState) {
    this.state = state
    this.publish(state)
  }

  /** The installed app: Anna.app on macOS, the Anna folder on Windows and Linux. */
  private installed() {
    const exe = process.execPath
    return process.platform === 'darwin' ? resolve(exe, '../../..') : dirname(exe)
  }

  async check(silent = false) {
    if (!app.isPackaged)
      return this.set({ state: 'current', message: '开发版不检查更新' })
    if (!silent)
      this.set({ state: 'checking' })
    try {
      const response = await fetch(`${this.base}/latest.json`, { redirect: 'follow', signal: AbortSignal.timeout(15000) })
      if (!response.ok)
        throw new Error(`HTTP ${response.status}`)
      this.plan = planUpdate(await response.json(), app.getVersion(), process.platform, process.arch)
      this.set(this.plan.available ? { state: 'available', version: this.plan.version, notes: this.plan.notes } : { state: 'current', version: this.plan.version, message: this.plan.reason })
    }
    catch (error) {
      if (!silent)
        this.set({ state: 'error', message: `检查更新失败：${error instanceof Error ? error.message : error}` })
    }
  }

  async install() {
    const plan = this.plan
    if (!plan?.available)
      throw new Error('没有可安装的更新')
    this.set({ state: 'downloading', version: plan.version })
    try {
      const response = await fetch(plan.url, { redirect: 'follow' })
      if (!response.ok)
        throw new Error(`下载失败 HTTP ${response.status}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (!verifyDigest(bytes, plan.sha256))
        throw new Error('下载的文件与发布记录不一致，已停止更新')
      const work = await mkdtemp(join(tmpdir(), 'anna-update-'))
      const archive = join(work, 'update.archive')
      await writeFile(archive, bytes)
      const unpacked = join(work, 'unpacked')
      await mkdir(unpacked)
      if (process.platform === 'darwin')
        await run('/usr/bin/ditto', ['-x', '-k', archive, unpacked])
      else if (process.platform === 'win32')
        await run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -Path '${archive}' -DestinationPath '${unpacked}' -Force`])
      else
        await run('tar', ['-xzf', archive, '-C', unpacked])
      const name = process.platform === 'darwin' ? 'Anna.app' : 'Anna'
      if (!(await readdir(unpacked)).includes(name))
        throw new Error(`更新包里没有 ${name}`)
      const current = this.installed()
      const relaunch = process.platform === 'darwin' ? `open ${JSON.stringify(current)}` : process.platform === 'win32' ? `Start-Process '${join(current, 'Anna.exe')}'` : `nohup ${JSON.stringify(join(current, 'anna'))} >/dev/null 2>&1 &`
      const script = swapScript(process.platform, { pid: process.pid, current, staged: join(unpacked, name), relaunch })
      const scriptPath = join(work, process.platform === 'win32' ? 'swap.ps1' : 'swap.sh')
      await writeFile(scriptPath, script, { mode: 0o700 })
      const child = process.platform === 'win32'
        ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { detached: true, stdio: 'ignore', windowsHide: true })
        : spawn('/bin/sh', [scriptPath], { detached: true, stdio: 'ignore' })
      child.unref()
      this.set({ state: 'ready', version: plan.version, message: '正在重启以完成更新…' })
      setTimeout(() => app.quit(), 400)
    }
    catch (error) {
      this.set({ state: 'error', version: plan.version, message: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }
}
