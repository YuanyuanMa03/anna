import { join } from 'node:path'
import process from 'node:process'
import electron from 'electron'
import { assertBuiltAssets } from './built-assets.mjs'

/** All desktop flows exercise the same source or packaged app, including Linux's launcher and software WebGL. */
export function desktopLaunch(data, env = {}) {
  const root = process.cwd()
  const packaged = process.env.ANNA_PACKAGED_APP
  if (!packaged)
    assertBuiltAssets(root)
  const executablePath = !packaged ? electron : process.platform === 'darwin' ? join(packaged, 'Contents/MacOS/Anna') : process.platform === 'win32' ? join(packaged, 'Anna.exe') : join(packaged, 'anna')
  // The packaged Linux launcher chooses its sandbox; CI source runs need the same existing Chromium workaround.
  const chromium = process.platform === 'linux' && process.env.CI ? [...(packaged ? [] : ['--no-sandbox']), '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []
  return {
    executablePath,
    args: [...chromium, ...(packaged ? [] : ['dist/host/apps/desktop/boot.js'])],
    cwd: packaged ? '/' : root,
    env: { ...process.env, ...env, ...(packaged && process.platform === 'darwin' && env.ANNA_TEST_SCRIPT ? { ANNA_TEST_VAULT: 'file' } : {}), ANNA_DATA_DIR: data, ANNA_ROOT: packaged ? '/nonexistent/anna-source' : root, ANNA_DEV_URL: packaged ? 'http://127.0.0.1:9' : '' },
  }
}
