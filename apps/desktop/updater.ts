import type { UpdatePlan } from '../../packages/shared/update'
import { execFile, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { app, shell } from 'electron'
import { planUpdate, ps, sh, swapScript, verifyDigest, verifyManifest } from '../../packages/shared/update'

const run = promisify(execFile)
/** `manual`: Anna can't replace itself here (the .deb in /opt, or /Applications for a standard user), so the update is a new installer. */
export interface UpdateState { state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'current', version?: string, notes?: string, message?: string, manual?: boolean }

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

  /** The swap script moves the installed app aside, so both it and its parent folder must be writable. */
  private async replaceable() {
    const current = this.installed()
    try {
      await access(dirname(current), constants.W_OK)
      await access(current, constants.W_OK)
      return true
    }
    catch { return false }
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
      const manifest = await response.json()
      // The checksum below only proves the download matches the manifest; the signature proves the manifest is ours.
      if (!verifyManifest(manifest))
        throw new Error('发布信息没有有效的签名，已停止更新')
      this.plan = planUpdate(manifest, app.getVersion(), process.platform, process.arch)
      this.set(this.plan.available ? { state: 'available', version: this.plan.version, notes: this.plan.notes, manual: !(await this.replaceable()) } : { state: 'current', version: this.plan.version, message: this.plan.reason })
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
    if (!(await this.replaceable())) {
      await shell.openExternal(`${this.base}/#download`)
      return this.set({ state: 'available', version: plan.version, notes: plan.notes, manual: true })
    }
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
        await run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${ps(archive)} -DestinationPath ${ps(unpacked)} -Force`])
      else
        await run('tar', ['-xzf', archive, '-C', unpacked])
      const name = process.platform === 'darwin' ? 'Anna.app' : 'Anna'
      if (!(await readdir(unpacked)).includes(name))
        throw new Error(`更新包里没有 ${name}`)
      const current = this.installed()
      // Quoted for the shell that runs it: a path with ', $ or ` in it stays one word.
      const relaunch = process.platform === 'darwin' ? `open ${sh(current)}` : process.platform === 'win32' ? `Start-Process -FilePath ${ps(join(current, 'Anna.exe'))}` : `nohup ${sh(join(current, 'anna'))} >/dev/null 2>&1 &`
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
