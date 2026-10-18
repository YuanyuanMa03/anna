import type { MenuItemConstructorOptions, UtilityProcess } from 'electron'
import type { AnnaEvent, Command, RuntimeSnapshot } from '../../packages/shared/contracts'
import type { Wire } from '../../packages/shared/rpc'
import type { TrayItem } from './tray-menu'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, shell, Tray, utilityProcess } from 'electron'
import { command, runtimeEvent } from '../../packages/shared/contracts'
import { dataDirectory } from '../../packages/shared/platform'
import { RpcPeer } from '../../packages/shared/rpc'
import { createVault } from '../../packages/shared/vault'
import { externalUrl } from './external-link'
import { trayTemplate } from './tray-menu'
import { Updater } from './updater'

const root = app.isPackaged ? app.getAppPath() : process.env.ANNA_ROOT ?? resolve(import.meta.dirname, '../../../..')
const data = dataDirectory(process.platform, process.env, app.getPath('appData'))
const mac = process.platform === 'darwin'
// The Keychain entry backing safeStorage is keyed by this name; changing it would orphan saved credentials.
app.setName('Anna Reborn')
mkdirSync(join(data, 'electron'), { recursive: true, mode: 0o700 })
app.setPath('userData', join(data, 'electron'))
/** An import link the OS handed over on the command line (Windows, Linux). */
function linkIn(argv: string[]) {
  return argv.find(arg => arg.startsWith('anna://'))
}
if (!app.requestSingleInstanceLock())
  app.exit(0)
app.on('second-instance', (_event, argv) => {
  const link = linkIn(argv)
  if (link)
    void openLink(link)
  const existing = BrowserWindow.getAllWindows()[0]
  existing?.show()
  existing?.focus()
})
// anna://v1/import?… (and cc-switch's format behind it) opens a confirmation in the providers tab. Registered only
// for the installed app, so a development build never takes over the scheme.
const links: string[] = []
if (app.isPackaged)
  app.setAsDefaultProtocolClient('anna')
app.on('open-url', (event, url) => {
  event.preventDefault()
  void openLink(url)
})
if (linkIn(process.argv))
  links.push(linkIn(process.argv)!)
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

let tray: Tray | undefined
let trayLatest: RuntimeSnapshot | undefined
let trayShown = ''

/** Rebuild the tray menu when what it shows changed (snapshots arrive often while the model streams). */
function refreshTray(snapshot?: RuntimeSnapshot) {
  trayLatest = snapshot ?? trayLatest
  const template = trayTemplate(trayLatest)
  const shown = JSON.stringify(template)
  if (!tray || shown === trayShown)
    return
  trayShown = shown
  const electron = (items: TrayItem[]): MenuItemConstructorOptions[] => items.map(({ run, submenu, ...item }) => ({ ...item, ...(submenu ? { submenu: electron(submenu) } : {}), ...(run ? { click: () => void runTray(run) } : {}) }))
  tray.setContextMenu(Menu.buildFromTemplate(electron(template)))
}

async function runTray(run: NonNullable<TrayItem['run']>) {
  if (run === 'quit')
    return app.quit()
  if (run === 'show') {
    window?.show()
    window?.focus()
    return
  }
  try {
    if (!peer)
      throw new Error('Anna 核心进程尚未启动')
    refreshTray(await peer.call<RuntimeSnapshot>('execute', run))
  }
  catch (error) {
    if (Notification.isSupported())
      new Notification({ title: 'Anna', body: error instanceof Error ? error.message : '操作失败' }).show()
  }
}

/** Hand an import link to the core (which only previews it) and show the providers tab; queued until both exist. */
let loaded = false
async function openLink(url: string) {
  if (!peer || !window || !loaded) {
    links.push(url)
    return
  }
  try {
    const snapshot = await peer.call<RuntimeSnapshot>('execute', { type: 'provider-link', link: url })
    emitToRenderer({ type: 'snapshot', snapshot })
  }
  catch (error) {
    if (Notification.isSupported())
      new Notification({ title: '导入链接没能打开', body: error instanceof Error ? error.message : '链接无效' }).show()
    return
  }
  emitToRenderer({ type: 'navigate', panel: 'providers' })
  window.show()
  window.focus()
}

function onCoreEvent(event: AnnaEvent) {
  emitToRenderer(event)
  if (event.type === 'snapshot')
    refreshTray(event.snapshot)
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
  const sponsor = { label: '赞助 Anna…', click: () => context.emit(runtimeEvent, { type: 'navigate', panel: 'sponsor' }) }
  return Menu.buildFromTemplate([
    mac
      ? { label: 'Anna', submenu: [{ label: '关于 Anna', role: 'about' }, sponsor, update, settings, { type: 'separator' }, { label: '隐藏 Anna', role: 'hide' }, { label: '隐藏其他', role: 'hideOthers' }, { type: 'separator' }, { label: '退出 Anna', role: 'quit' }] }
      : { label: 'Anna', submenu: [sponsor, update, settings, { type: 'separator' }, { label: '退出 Anna', role: 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '窗口', submenu: mac ? [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' }, { role: 'front', label: '全部置于前面' }] : [{ role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭' }] },
  ])
}

async function start() {
  await app.whenReady()
  window = new BrowserWindow({ width: 1280, height: 860, minWidth: 880, minHeight: 650, title: 'Anna', backgroundColor: '#f7f3f8', icon: mac ? undefined : join(root, 'dist/renderer/favicon.png'), webPreferences: { preload: join(root, 'dist/host/apps/desktop/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  const win = window
  // No new windows and no navigation inside the app; web links (e.g. a provider's "get a key" page) go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const external = externalUrl(url)
    if (external)
      void shell.openExternal(external)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => { event.preventDefault() })
  const { context, dispose } = createContext(ipcMain, win, { onlySameWindow: false })
  emitToRenderer = event => context.emit(runtimeEvent, event)
  win.on('closed', () => { dispose(); emitToRenderer = () => {} })
  app.setAboutPanelOptions({ applicationName: 'Anna', applicationVersion: app.getVersion(), copyright: 'Copyright © 2026 YuanyuanMa03' })
  Menu.setApplicationMenu(menu(context))
  // The tray switches providers like cc-switch's; on macOS it sits in the menu bar.
  tray = new Tray(nativeImage.createFromPath(join(root, 'dist/renderer/favicon.png')).resize({ width: mac ? 18 : 24, height: mac ? 18 : 24 }))
  tray.setToolTip('Anna')
  refreshTray()
  // The scripted acceptance reads the tray menu it can't click.
  if (process.env.ANNA_TEST_SCRIPT)
    Object.assign(globalThis, { annaTrayMenu: () => JSON.parse(trayShown || '[]') as TrayItem[] })
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
      // File paths for provider export and import only ever come from the user's own dialog.
      if (request.type === 'providers-export') {
        const choice = await dialog.showSaveDialog(win, { title: request.includeKeys ? '导出服务商（含密钥）' : '导出服务商', defaultPath: 'anna-providers.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
        forward = choice.canceled || !choice.filePath ? { type: 'snapshot' } : { type: 'providers-export', includeKeys: request.includeKeys, path: choice.filePath }
      }
      if (request.type === 'providers-import') {
        const choice = await dialog.showOpenDialog(win, { title: '导入服务商', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
        forward = choice.canceled || !choice.filePaths[0] ? { type: 'snapshot' } : { type: 'providers-import', path: choice.filePaths[0] }
      }
      if (request.type === 'update-check' || request.type === 'update-install') {
        await (request.type === 'update-check' ? updater.check() : updater.install())
        forward = { type: 'snapshot' }
      }
      if (!peer)
        throw new Error('Anna 核心进程尚未启动')
      const snapshot = await peer.call<RuntimeSnapshot>('execute', forward)
      refreshTray(snapshot)
      return { ok: true as const, snapshot }
    }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : 'Anna 操作失败' } }
  })
  if (!app.isPackaged && process.env.ANNA_DEV_URL)
    await win.loadURL(process.env.ANNA_DEV_URL)
  else await win.loadFile(join(root, 'dist/renderer/index.html'))
  loaded = true
  for (const link of links.splice(0)) void openLink(link)
}
void start().catch((error) => {
  const message = error instanceof Error ? error.message : 'Anna startup failed'
  console.error(message)
  if (app.isReady())
    dialog.showErrorBox('Anna 启动失败', message)
  app.quit()
})
app.on('window-all-closed', () => app.quit())
