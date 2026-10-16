import type { AnnaEvent } from '../../packages/shared/contracts'
import { mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage } from 'electron'
import { Host } from '../../packages/anna-host/host'
import { command, runtimeEvent } from '../../packages/shared/contracts'

const root = app.isPackaged ? app.getAppPath() : process.env.ANNA_ROOT ?? resolve(import.meta.dirname, '../../../..')
const data = process.env.ANNA_DATA_DIR ?? join(homedir(), '.local', 'share', 'anna-dsh')
app.setName('Anna Reborn')
mkdirSync(join(data, 'electron'), { recursive: true, mode: 0o700 })
app.setPath('userData', join(data, 'electron'))
if (!app.requestSingleInstanceLock())
  app.exit(0)
app.on('second-instance', () => {
  const existing = BrowserWindow.getAllWindows()[0]
  existing?.show()
  existing?.focus()
})
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
  app.setAboutPanelOptions({ applicationName: 'Anna', applicationVersion: app.getVersion(), copyright: 'Copyright © 2026 Anna contributors' })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Anna', submenu: [
      { label: '关于 Anna', role: 'about' },
      { label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => context.emit(runtimeEvent, { type: 'navigate', panel: 'settings' }) },
      { type: 'separator' },
      { label: '隐藏 Anna', role: 'hide' },
      { label: '隐藏其他', role: 'hideOthers' },
      { type: 'separator' },
      { label: '退出 Anna', role: 'quit' },
    ] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' }, { role: 'front', label: '全部置于前面' }] },
  ]))
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
  if (!app.isPackaged && process.env.ANNA_DEV_URL)
    await window.loadURL(process.env.ANNA_DEV_URL)
  else await window.loadFile(join(root, 'dist/renderer/index.html'))
}
void start().catch((error) => {
  const message = error instanceof Error ? error.message : 'Anna startup failed'
  console.error(message)
  if (app.isReady())
    dialog.showErrorBox('Anna 启动失败', message)
  app.quit()
})
app.on('window-all-closed', () => app.quit())
