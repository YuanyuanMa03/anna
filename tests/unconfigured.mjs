import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import electron from 'electron'
import { _electron } from 'playwright'

async function main() {
  await mkdir('.data', { recursive: true })
  await mkdir('artifacts', { recursive: true })
  const data = await mkdtemp(resolve('.data/unconfigured-'))
  const packaged = process.env.ANNA_PACKAGED_APP
  const desktop = await _electron.launch({ executablePath: packaged ? `${packaged}/Contents/MacOS/Anna` : electron, args: packaged ? [] : ['dist/host/apps/desktop/main.js'], env: { ...process.env, ANNA_ROOT: process.cwd(), ANNA_DATA_DIR: data, ANNA_DEV_URL: '', ANNA_TEST_CDP: '' } })
  try {
    const page = await desktop.firstWindow()
    await page.getByRole('button', { name: '配置模型', exact: true }).waitFor()
    const reply = await page.evaluate(() => window.anna.invoke({ type: 'snapshot' }))
    assert(reply.ok)
    assert.equal(reply.snapshot.state, 'unconfigured')
    assert.deepEqual(reply.snapshot.messages, [])
    await page.getByRole('button', { name: '配置模型', exact: true }).click()
    await page.getByRole('dialog', { name: '模型与设置' }).waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'API Key', exact: true }).inputValue(), '')
    await page.screenshot({ path: 'artifacts/unconfigured-settings.png' })
    process.stdout.write('Unconfigured desktop: real model form, empty conversation, no fabricated response.\n')
  }
  finally { await desktop.close() }
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
