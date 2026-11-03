import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import electron from 'electron'
import { _electron } from 'playwright'
import { assertBuiltAssets } from './built-assets.mjs'

async function main() {
  await mkdir('.data', { recursive: true })
  await mkdir('artifacts', { recursive: true })
  const data = await mkdtemp(resolve('.data/unconfigured-'))
  const packaged = process.env.ANNA_PACKAGED_APP
  if (!packaged)
    assertBuiltAssets()
  const desktop = await _electron.launch({ executablePath: packaged ? process.platform === 'win32' ? `${packaged}/Anna.exe` : `${packaged}/Contents/MacOS/Anna` : electron, args: packaged ? [] : ['dist/host/apps/desktop/main.js'], env: { ...process.env, ANNA_ROOT: process.cwd(), ANNA_DATA_DIR: data, ANNA_DEV_URL: '', ANNA_TEST_CDP: '' } })
  try {
    const page = await desktop.firstWindow()
    const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    assert.equal((await page.locator('.brand span').textContent()).trim(), `v${version}`)
    await page.getByRole('dialog', { name: 'Anna 档案' }).waitFor()
    const reply = await page.evaluate(() => window.anna.invoke({ type: 'snapshot' }))
    assert(reply.ok)
    assert.equal(reply.snapshot.state, 'unconfigured')
    assert.deepEqual(reply.snapshot.messages, [])
    await page.locator('.model-canvas[data-state="ready"]').waitFor({ timeout: 30000 })
    const flow = page.getByRole('dialog', { name: 'Anna 档案' })
    assert.equal(await flow.getByRole('button', { name: '2 选择大脑' }).isDisabled(), true)
    assert.equal(await flow.getByRole('button', { name: '4 认识彼此' }).isDisabled(), true)
    assert.equal(await flow.getByRole('button', { name: '关闭设置' }).count(), 0)
    await flow.getByRole('button', { name: '选择工作目录…' }).waitFor()
    await page.screenshot({ path: 'artifacts/unconfigured-stage.png' })
    process.stdout.write('Unconfigured desktop: real model form, empty conversation, no fabricated response.\n')
  }
  finally { await desktop.close() }
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
