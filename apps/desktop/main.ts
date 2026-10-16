import type { AnnaEvent } from '../../packages/shared/contracts'
import { mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { Host } from '../../packages/anna-host/host'
import { command, runtimeEvent } from '../../packages/shared/contracts'

const root = process.env.ANNA_ROOT ?? resolve(import.meta.dirname, '../../../..')
const data = process.env.ANNA_DATA_DIR ?? join(homedir(), '.local', 'share', 'anna-dsh')
app.setName('Anna Reborn')
mkdirSync(join(data, 'electron'), { recursive: true, mode: 0o700 })
app.setPath('userData', join(data, 'electron'))
if (!app.requestSingleInstanceLock())
  app.quit()
if (process.env.ANNA_TEST_CDP) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.ANNA_TEST_CDP)
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
}
let host: Host | undefined
let closing = false
app.on('before-quit', (event) => {
  if (closing)
    return
  event.preventDefault()
  closing = true
  void Promise.resolve(host?.close()).then(() => app.quit()).catch(() => { closing = false })
})
process.on('SIGTERM', () => app.quit())
process.on('SIGINT', () => app.quit())
async function start() {
  await app.whenReady()
  const window = new BrowserWindow({ width: 1280, height: 860, minWidth: 880, minHeight: 650, title: 'Anna', backgroundColor: '#f7f3f8', webPreferences: { preload: join(root, 'dist/host/apps/desktop/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => { event.preventDefault() })
  const { context, dispose } = createContext(ipcMain, window, { onlySameWindow: false })
  window.on('closed', dispose)
  const vault = {
    async read() {
      try {
        const bytes = await readFile(join(data, 'credential.bin'))
        if (!safeStorage.isEncryptionAvailable())
          throw new Error('系统凭据存储不可用')
        return safeStorage.decryptString(bytes)
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          return ''; throw error
      }
    },
    async write(key: string) {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error('系统凭据存储不可用，无法保存 API Key')
      await writeFile(join(data, 'credential.bin'), safeStorage.encryptString(key), { mode: 0o600 })
    },
  }
  host = new Host(root, data, vault, (event: AnnaEvent) => context.emit(runtimeEvent, event))
  await host.initialize()
  defineInvokeHandler(context, command, async ({ command: request }, options) => {
    if (options?.raw?.ipcMainEvent.sender.id !== window.webContents.id)
      return { ok: false as const, error: 'Unauthorized window' }
    try { return { ok: true as const, snapshot: await host!.execute(request) } }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : 'Anna 操作失败' } }
  })
  if (process.env.ANNA_DEV_URL)
    await window.loadURL(process.env.ANNA_DEV_URL)
  else await window.loadFile(join(root, 'dist/renderer/index.html'))
}
void start().catch((error) => { console.error(error instanceof Error ? error.message : 'Anna startup failed'); app.quit() })
app.on('window-all-closed', () => app.quit())
