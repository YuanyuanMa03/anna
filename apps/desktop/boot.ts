import { join } from 'node:path'
import process from 'node:process'
import { app, dialog } from 'electron'
import { createAppLog } from '../../packages/shared/app-log'
import { dataDirectory } from '../../packages/shared/platform'

/**
 * The first thing that runs, with almost nothing to go wrong. Everything main.js imports loads after this, so a module
 * that cannot be found becomes a line in the log and a message a person can act on, not a raw stack in a dialog.
 */
const entry = (!app.isPackaged && process.env.ANNA_TEST_MAIN) || './main.js'
// Awaited: Electron finishes starting once this module has, and main.js sets its data folder and graphics switches first.
// eslint-disable-next-line antfu/no-top-level-await -- required here, as the line above says
try { await import(entry) }
catch (error) {
  const log = createAppLog(join(dataDirectory(process.platform, process.env, app.getPath('appData')), 'logs'))
  log.write('main', `startup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  // Safe before `ready`. Waiting for `ready` here would never end, because this module is what holds it back.
  if (!process.env.ANNA_QUIET_FAILURES)
    dialog.showErrorBox('Anna 没能启动', `安装可能不完整，请重新安装一次。\n\n日志在 ${log.path}`)
  app.exit(1)
}
