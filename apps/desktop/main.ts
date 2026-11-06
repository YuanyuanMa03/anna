import type { MenuItemConstructorOptions, UtilityProcess } from 'electron'
import type { Buffer } from 'node:buffer'
import type { AnnaEvent, Command, RuntimeSnapshot } from '../../packages/shared/contracts'
import type { Wire } from '../../packages/shared/rpc'
import type { TrayItem } from './tray-menu'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, shell, Tray, utilityProcess } from 'electron'
import { moveDataHome } from '../../packages/anna-host/data-home'
import { createAppLog } from '../../packages/shared/app-log'
import { command, runtimeEvent } from '../../packages/shared/contracts'
import { graphicsSummary } from '../../packages/shared/graphics'
import { dataDirectory, earlierDataDirectory } from '../../packages/shared/platform'
import { RpcPeer } from '../../packages/shared/rpc'
import { packagedCoreEnv } from '../../packages/shared/search-path'
import { createVault } from '../../packages/shared/vault'
import { voiceCommand } from '../../packages/voice/contracts'
import { externalUrl } from './external-link'
import { trayTemplate } from './tray-menu'
import { Updater } from './updater'

const root = app.isPackaged ? app.getAppPath() : process.env.ANNA_ROOT ?? resolve(import.meta.dirname, '../../../..')
const data = dataDirectory(process.platform, process.env, app.getPath('appData'))
const earlier = earlierDataDirectory(process.platform, process.env)
if (earlier) {
  // Never stands in the way of starting: she opens with a new home and says where the old one still is.
  try { moveDataHome(earlier, data) }
  catch (error) { dialog.showErrorBox('Anna 的数据没能搬家', `以前的数据还在 ${earlier}，这次先用新的。\n${error instanceof Error ? error.message : String(error)}`) }
}
const mac = process.platform === 'darwin'
/**
 * Automated desktop runs on the developer's Mac stay out of the way: no Dock icon, no window taking focus. The page
 * still loads and paints (tests drive and screenshot it); only the window is never shown.
 */
// Two flags, both set only by tests/desktop-launch.mjs, so a variable left in a shell cannot hide the app by itself;
// the tray's 显示 still brings the window back.
const background = process.env.ANNA_TEST_RUN === '1' && process.env.ANNA_TEST_BACKGROUND === '1'
// Software WebGL when a driver is missing or blocked. Anna's window only ever shows her own pages, and without it she has no body at all.
if (process.platform === 'win32')
  app.commandLine.appendSwitch('enable-unsafe-swiftshader')
// The Keychain entry backing safeStorage is keyed by this name; changing it would orphan saved credentials.
app.setName('Anna Reborn')
mkdirSync(join(data, 'electron'), { recursive: true, mode: 0o700 })
app.setPath('userData', join(data, 'electron'))
const log = createAppLog(join(data, 'logs'))
// Only the test harness has a stderr to forward to, and it may go away first.
process.stderr.on('error', () => {})
log.write('main', `Anna ${app.getVersion()} on ${process.platform} ${process.arch}`)
/** The window cannot explain this itself: say what happened and where the details are, once. */
let reportedFatal = false
function reportFatal(message: string) {
  if (reportedFatal || process.env.ANNA_QUIET_FAILURES)
    return
  reportedFatal = true
  dialog.showErrorBox('Anna 遇到了问题', `${message}\n\n日志在 ${log.path}`)
}
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
  if (!background) {
    existing?.show()
    existing?.focus()
  }
})
// anna://v1/import?… (and cc-switch's format behind it) opens a confirmation in the providers tab. Registered only
// for the installed app, so a development build never takes over the scheme.
const links: string[] = []
// A run against its own data folder (the package smoke test, say) must not take anna:// from the installed app.
if (app.isPackaged && !process.env.ANNA_DATA_DIR)
  app.setAsDefaultProtocolClient('anna')
app.on('open-url', (event, url) => {
  event.preventDefault()
  void openLink(url)
})
if (linkIn(process.argv))
  links.push(linkIn(process.argv)!)
// Remote debugging for the test harness only: never in the installed app, whatever its environment says.
if (process.env.ANNA_TEST_CDP && !app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.ANNA_TEST_CDP)
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
}

/** Credentials are encrypted with the OS store; explicit scripted tests can use isolated file fixtures. */
const testVault = Boolean(process.env.ANNA_TEST_SCRIPT && process.env.ANNA_TEST_VAULT === 'file')
const fixtureStorage = { isEncryptionAvailable: () => false, encryptString: () => { throw new Error('Fixture vault has no encryption') }, decryptString: () => { throw new Error('Fixture vault cannot read OS credentials') } }
const vault = createVault({ dir: data, safeStorage: testVault ? fixtureStorage : safeStorage, platform: testVault ? 'linux' : process.platform })
const vaultNames = new Set(['credential.bin', 'weixin-credential.bin', 'providers.bin', 'senses.bin'])

let window: BrowserWindow | undefined
let core: UtilityProcess | undefined
let peer: RpcPeer | undefined
let closing = false
let coreAnswered = false
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
    if (background && mac)
      app.setActivationPolicy('regular')
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
  if (!background) {
    window.show()
    window.focus()
  }
}

function onCoreEvent(event: AnnaEvent) {
  emitToRenderer(event)
  if (event.type === 'core' && event.status === 'ready') {
    coreAnswered = true
    log.write('main', 'core ready')
  }
  if (event.type === 'snapshot')
    refreshTray(event.snapshot)
  if (event.type === 'notify' && window && !background && !window.isFocused() && Notification.isSupported())
    new Notification({ title: event.title, body: event.body, silent: false }).show()
}

/** Start (or restart) the core utility process. Repeated crashes stop the restart loop. */
function startCore() {
  const child = utilityProcess.fork(join(root, 'dist/host/apps/desktop/core.js'), [], {
    serviceName: 'Anna Core',
    stdio: 'pipe',
    // The packaged agent finds the ripgrep and fd shipped beside the archive instead of downloading them.
    env: { ...(app.isPackaged ? packagedCoreEnv(process.env, process.resourcesPath, process.platform) : process.env), ANNA_CORE_ROOT: root, ANNA_CORE_DATA: data },
  })
  // A packaged app has no console: the file is the only place a core crash can be read afterwards.
  const output = [child.stdout, child.stderr].map((stream) => {
    const lines = log.stream('core')
    stream?.on('data', (chunk: Buffer) => {
      lines.push(chunk)
      // An installed Windows app has no stderr to write to; only the test harness reads this.
      if (!app.isPackaged || process.env.ANNA_TEST_SCRIPT)
        process.stderr.write(chunk)
    })
    stream?.on('end', () => lines.flush())
    return lines
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
    for (const lines of output)
      lines.flush()
    log.write('main', `core exited with code ${code}`)
    if (core !== child || closing)
      return
    const now = Date.now()
    restarts = [...restarts.filter(time => now - time < 60000), now]
    if (restarts.length > 3) {
      log.write('main', 'core gave up after repeated exits')
      emitToRenderer({ type: 'core', status: 'restarting', message: `Anna 核心进程反复退出（代码 ${code}），已停止自动重启。日志在 ${log.path}` })
      reportFatal(`Anna 的核心进程反复退出（代码 ${code}），已停止自动重启。`)
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
  // Nothing has crashed, yet nothing has answered: don't leave a person watching "waking up" forever.
  setTimeout(() => {
    if (!coreAnswered && !closing && restarts.length <= 3) {
      log.write('main', 'core has not answered after a minute')
      emitToRenderer({ type: 'core', status: 'restarting', message: `Anna 醒得比平时慢，可能是杀毒软件在扫描或安装不完整。日志在 ${log.path}` })
    }
  }, 60000).unref()
  if (background && mac)
    app.setActivationPolicy('accessory')
  window = new BrowserWindow({ ...(background ? { show: false, paintWhenInitiallyHidden: true } : {}), width: 1280, height: 860, minWidth: 880, minHeight: 650, title: 'Anna', backgroundColor: '#f7f3f8', icon: mac ? undefined : join(root, 'dist/renderer/favicon.png'), webPreferences: { preload: join(root, 'dist/host/apps/desktop/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, ...(background ? { backgroundThrottling: false } : {}) } })
  const win = window
  win.webContents.session.setDisplayMediaRequestHandler((_request, callback) => callback({}))
  const mediaAllowed = new Set<string>()
  win.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    contents?.id === win.webContents.id && details.isMainFrame && (permission === 'media' && details.mediaType === 'audio' && mediaAllowed.has('audio')))
  win.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const types = 'mediaTypes' in details ? details.mediaTypes : undefined
    if (contents.id !== win.webContents.id || permission !== 'media' || !details.isMainFrame || !types?.length || types.some(type => type !== 'audio')) {
      callback(false)
      return
    }
    void dialog.showMessageBox(win, { type: 'question', title: 'Anna 麦克风授权', message: '允许 Anna 使用麦克风？', detail: '仅用于你主动开启的语音录音。录音会交给所选的本地或云端识别服务，关闭面板会停止采集。', buttons: ['取消', '允许'], defaultId: 0, cancelId: 0 }).then(({ response }) => {
      const allowed = response === 1 && !win.isDestroyed()
      if (allowed)
        types.forEach(type => mediaAllowed.add(type))
      callback(allowed)
    }).catch(() => callback(false))
  })
  // No new windows and no navigation inside the app; web links (e.g. a provider's "get a key" page) go to the browser.
  const browse = (url: string) => {
    const external = externalUrl(url, win.webContents.getURL())
    if (external)
      void shell.openExternal(external)
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    browse(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
    browse(event.url)
  })
  win.webContents.on('did-finish-load', () => log.write('main', 'window loaded'))
  // By the first page load the GPU process has reported; at startup the status is only a placeholder.
  win.webContents.once('did-finish-load', () => {
    void app.getGPUInfo('basic')
      .then(info => log.write('main', graphicsSummary(app.getGPUFeatureStatus(), info as Parameters<typeof graphicsSummary>[1])))
      .catch((error: unknown) => log.write('main', `graphics: unavailable (${error instanceof Error ? error.message : String(error)})`))
  })
  win.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
    // -3 is a navigation Anna itself cancelled.
    if (mainFrame && code !== -3) {
      log.write('main', `window failed to load: ${code} ${description}`)
      reportFatal('Anna 的窗口没能打开，安装可能不完整，请重新安装一次。')
    }
  })
  win.webContents.on('preload-error', (_event, _path, error) => log.write('main', `window failed to load: preload ${error.message}`))
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error')
      log.write('window', details.message)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    log.write('main', `window process gone: ${details.reason} (${details.exitCode})`)
    if (!closing)
      reportFatal('Anna 的窗口意外关闭了，请重新打开 Anna。')
  })
  app.on('child-process-gone', (_event, details) => log.write('main', `${details.type} process gone: ${details.reason} (${details.exitCode})`))
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
  defineInvokeHandler(context, voiceCommand, async ({ request }, options) => {
    if (options?.raw?.ipcMainEvent.sender.id !== win.webContents.id || options.raw.ipcMainEvent.senderFrame !== win.webContents.mainFrame)
      return { ok: false as const, error: 'Unauthorized window' }
    try {
      if (!peer)
        throw new Error('核心进程尚未启动')
      return await peer.call<import('../../packages/voice/contracts').VoiceReply>('voice', request)
    }
    catch { return { ok: false as const, error: '语音服务尚未就绪，请稍后重试' } }
  })
  defineInvokeHandler(context, command, async ({ command: request }, options) => {
    if (options?.raw?.ipcMainEvent.sender.id !== win.webContents.id)
      return { ok: false as const, error: 'Unauthorized window' }
    try {
      let forward: Command = request
      // A workspace only ever comes from the user's own folder dialog, never as a path from the window (the scripted
      // acceptance test, which can't click a native dialog, is the one exception).
      if (request.type === 'workspace' && !process.env.ANNA_TEST_SCRIPT)
        throw new Error('工作文件夹只能通过选择对话框更换')
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
  log.write('main', `startup failed: ${error instanceof Error ? error.stack ?? message : message}`)
  if (app.isReady() && !process.env.ANNA_QUIET_FAILURES)
    dialog.showErrorBox('Anna 启动失败', `${message}\n\n日志在 ${log.path}`)
  app.quit()
})
app.on('window-all-closed', () => app.quit())
