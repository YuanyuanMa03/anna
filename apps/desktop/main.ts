import type { UtilityProcess } from 'electron'
import type { AnnaEvent, Command, RuntimeSnapshot } from '../../packages/shared/contracts'
import type { Wire } from '../../packages/shared/rpc'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, safeStorage, utilityProcess } from 'electron'
import { command, runtimeEvent } from '../../packages/shared/contracts'
import { dataDirectory } from '../../packages/shared/platform'
import { RpcPeer } from '../../packages/shared/rpc'
import { createVault } from '../../packages/shared/vault'
import { Updater } from './updater'

const root = app.isPackaged ? app.getAppPath() : process.env.ANNA_ROOT ?? resolve(import.meta.dirname, '../../../..')
const data = dataDirectory(process.platform, process.env, app.getPath('appData'))
const mac = process.platform === 'darwin'
// The Keychain entry backing safeStorage is keyed by this name; changing it would orphan saved credentials.
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

/** Credentials are encrypted with the OS store (Keychain, DPAPI, libsecret) and only ever decrypted here. */
const vault = createVault({ dir: data, safeStorage, platform: process.platform })
const vaultNames = new Set(['credential.bin', 'weixin-credential.bin', 'providers.bin'])

let window: BrowserWindow | undefined
let core: UtilityProcess | undefined
let peer: RpcPeer | undefined
let closing = false
let restarts: number[] = []
let emitToRenderer: (event: AnnaEvent) => void = () => {}
const updater = new Updater(process.env.ANNA_RELEASE_BASE ?? 'https://anna.mayuanyuan.top', state => emitToRenderer({ type: 'update', ...state }))

function onCoreEvent(event: AnnaEvent) {
  emitToRenderer(event)
  if (event.type === 'notify' && window && !window.isFocused() && Notification.isSupported())
    new Notification({ title: event.title, body: event.body, silent: false }).show()
}

/** Start (or restart) the core utility process. Repeated crashes stop the restart loop. */
function startCore() {
  const child = utilityProcess.fork(join(root, 'dist/host/apps/desktop/core.js'), [], {
    serviceName: 'Anna Core',
    stdio: 'inherit',
    env: { ...process.env, ANNA_CORE_ROOT: root, ANNA_CORE_DATA: data },
  })
  const rpc = new RpcPeer(message => child.postMessage(message), {
    'vault.read': ({ name }: { name: string }) => {
      if (!vaultNames.has(name))
        throw new Error('unknown vault')
      return vault.read(name)
    },
    'vault.write': ({ name, value }: { name: string, value: string }) => {
      if (!vaultNames.has(name))
        throw new Error('unknown vault')
      return vault.write(name, value)
    },
    'vault.mode': () => vault.mode(),
  }, onCoreEvent)
  child.on('message', message => void rpc.receive(message as Wire))
  child.on('exit', (code) => {
    rpc.fail('Anna 核心进程正在重启，请稍候再试')
    if (core !== child || closing)
      return
    const now = Date.now()
    restarts = [...restarts.filter(time => now - time < 60000), now]
    if (restarts.length > 3) {
      emitToRenderer({ type: 'core', status: 'restarting', message: `Anna 核心进程反复退出（代码 ${code}），已停止自动重启。请查看日志后重新打开 Anna。` })
      return
    }
    emitToRenderer({ type: 'core', status: 'restarting', message: `Anna 核心进程意外退出（代码 ${code}），正在重启…` })
    setTimeout(startCore, 800)
  })
  core = child
  peer = rpc
}

app.on('before-quit', (event) => {
  if (closing || !core)
    return
  event.preventDefault()
  closing = true
  const child = core
  void Promise.race([peer?.call('shutdown'), new Promise(resolve => setTimeout(resolve, 5000))]).finally(() => {
    child.kill()
    app.quit()
  })
})
process.on('SIGTERM', () => app.quit())
process.on('SIGINT', () => app.quit())

function menu(context: ReturnType<typeof createContext>['context']) {
  const settings = { label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => context.emit(runtimeEvent, { type: 'navigate', panel: 'settings' }) }
  const update = { label: '检查更新…', click: () => void updater.check() }
  return Menu.buildFromTemplate([
    mac
      ? { label: 'Anna', submenu: [{ label: '关于 Anna', role: 'about' }, update, settings, { type: 'separator' }, { label: '隐藏 Anna', role: 'hide' }, { label: '隐藏其他', role: 'hideOthers' }, { type: 'separator' }, { label: '退出 Anna', role: 'quit' }] }
      : { label: 'Anna', submenu: [update, settings, { type: 'separator' }, { label: '退出 Anna', role: 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '窗口', submenu: mac ? [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' }, { role: 'front', label: '全部置于前面' }] : [{ role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭' }] },
  ])
}

async function start() {
  await app.whenReady()
  window = new BrowserWindow({ width: 1280, height: 860, minWidth: 880, minHeight: 650, title: 'Anna', backgroundColor: '#f7f3f8', icon: mac ? undefined : join(root, 'dist/renderer/favicon.png'), webPreferences: { preload: join(root, 'dist/host/apps/desktop/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  const win = window
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => { event.preventDefault() })
  const { context, dispose } = createContext(ipcMain, win, { onlySameWindow: false })
  emitToRenderer = event => context.emit(runtimeEvent, event)
  win.on('closed', () => { dispose(); emitToRenderer = () => {} })
  app.setAboutPanelOptions({ applicationName: 'Anna', applicationVersion: app.getVersion(), copyright: 'Copyright © 2026 Anna contributors' })
  Menu.setApplicationMenu(menu(context))
  startCore()
  // Quietly check for updates shortly after launch and then every six hours.
  setTimeout(() => void updater.check(true), 10000)
  setInterval(() => void updater.check(true), 6 * 60 * 60 * 1000)
  defineInvokeHandler(context, command, async ({ command: request }, options) => {
    if (options?.raw?.ipcMainEvent.sender.id !== win.webContents.id)
      return { ok: false as const, error: 'Unauthorized window' }
    try {
      let forward: Command = request
      if (request.type === 'choose-workspace') {
        const choice = await dialog.showOpenDialog(win, { title: '选择 Anna 可以处理的工作文件夹', properties: ['openDirectory', 'createDirectory'] })
        if (choice.canceled || !choice.filePaths[0])
          forward = { type: 'snapshot' }
        else
          forward = { type: 'workspace', path: choice.filePaths[0] }
      }
      if (request.type === 'update-check' || request.type === 'update-install') {
        await (request.type === 'update-check' ? updater.check() : updater.install())
        forward = { type: 'snapshot' }
      }
      if (!peer)
        throw new Error('Anna 核心进程尚未启动')
      return { ok: true as const, snapshot: await peer.call<RuntimeSnapshot>('execute', forward) }
    }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : 'Anna 操作失败' } }
  })
  if (!app.isPackaged && process.env.ANNA_DEV_URL)
    await win.loadURL(process.env.ANNA_DEV_URL)
  else await win.loadFile(join(root, 'dist/renderer/index.html'))
}
void start().catch((error) => {
  const message = error instanceof Error ? error.message : 'Anna startup failed'
  console.error(message)
  if (app.isReady())
    dialog.showErrorBox('Anna 启动失败', message)
  app.quit()
})
app.on('window-all-closed', () => app.quit())
