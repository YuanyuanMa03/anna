import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { _electron } from 'playwright'

async function main() {
  const bundle = resolve(process.argv[2])
  const data = await mkdtemp(resolve('.data/packaged-smoke-'))
  const source = join(homedir(), '.local/share/anna-dsh')
  await copyFile(join(source, 'credential.bin'), join(data, 'credential.bin'))
  const settings = JSON.parse(await readFile(join(source, 'settings.json'), 'utf8'))
  delete settings.sessionId
  await writeFile(join(data, 'settings.json'), JSON.stringify(settings), { mode: 0o600 })
  const desktop = await _electron.launch({ executablePath: join(bundle, 'Contents/MacOS/Anna'), args: [], cwd: '/', env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ANNA_ROOT: '/nonexistent/anna-source', ANNA_DEV_URL: 'http://127.0.0.1:9', ANNA_DATA_DIR: data } })
  try {
    const page = await desktop.firstWindow()
    await page.locator('.connection i.online').waitFor({ timeout: 60000 })
    await page.locator('.model-canvas[data-state="ready"]').waitFor({ timeout: 30000 })
    const info = await desktop.evaluate(({ app, Menu }) => ({ packaged: app.isPackaged, root: app.getAppPath(), version: app.getVersion(), menu: Menu.getApplicationMenu().items.map(item => item.label) }))
    assert(info.packaged)
    assert.equal(info.root, join(bundle, 'Contents/Resources/app'))
    assert.deepEqual(info.menu, ['Anna', '编辑', '窗口'])
    await desktop.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === '设置…').click())
    await page.getByRole('dialog', { name: '模型与设置' }).waitFor()
    await page.getByRole('button', { name: '关闭设置', exact: true }).click()
    await page.screenshot({ path: 'artifacts/packaged-smoke.png' })
    await writeFile('artifacts/packaged-smoke.json', JSON.stringify({ ...info, data, runtime: 'pi-in-process', modelLoaded: true, nativeSettingsMenu: true, sourceAndDevServerIgnored: true }, null, 2))
    process.stdout.write('Packaged app, in-process runtime, real model asset, and native settings menu passed.\n')
  }
  finally { await desktop.close() }
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
