/* eslint-disable antfu/no-top-level-await, no-console -- Native UI acceptance without provider requests. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import electron from 'electron'
import { _electron } from 'playwright'

await mkdir('.data', { recursive: true })
await mkdir('artifacts/live2d-authoring', { recursive: true })
const data = await mkdtemp(resolve('.data/room-ui-'))
const evidence = { data, providerRequests: false, checks: [], errors: [] }
const desktop = await _electron.launch({ executablePath: electron, args: ['dist/host/apps/desktop/main.js'], env: { ...process.env, ANNA_ROOT: process.cwd(), ANNA_DATA_DIR: data, ANNA_DEV_URL: '', ANNA_TEST_CDP: '' } })
try {
  const page = await desktop.firstWindow()
  page.on('pageerror', error => evidence.errors.push(error.message))
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()
  await page.locator('.room-model[data-state=ready]').waitFor()
  await page.waitForFunction(() => Number(document.querySelector('.room-model')?.getAttribute('data-blink')) > 0.6, { timeout: 10000 })
  evidence.checks.push('Real Cubism model loaded; automatic blink advanced in the native window')
  await page.locator('.room-touch').click({ position: { x: 180, y: 140 } })
  await page.getByRole('button', { name: '关闭抽屉', exact: true }).click()
  evidence.checks.push('Character click opens the existing work drawer')
  await page.getByRole('button', { name: '模型与设置', exact: true }).click()
  await page.getByRole('dialog', { name: '模型与设置', exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()
  await page.getByRole('button', { name: '对话记录', exact: true }).click()
  await page.getByRole('button', { name: '关闭抽屉', exact: true }).click()
  evidence.checks.push('Existing settings and history remain accessible')
  const before = await page.evaluate(async () => (await window.anna.invoke({ type: 'snapshot' })).snapshot)
  await page.getByRole('button', { name: '原有外观', exact: true }).click()
  await page.locator('.model-canvas[data-state=ready][data-character=haru]').waitFor()
  await page.getByRole('button', { name: '房间外观', exact: true }).click()
  await page.locator('.room-model[data-state=ready]').waitFor()
  const after = await page.evaluate(async () => (await window.anna.invoke({ type: 'snapshot' })).snapshot)
  assert.deepEqual(after.settings, before.settings)
  assert.equal(after.sessionId, before.sessionId)
  assert.deepEqual(after.messages, before.messages)
  evidence.checks.push('Switching appearance does not alter settings, session or conversation')
  await page.evaluate(() => window.anna.invoke({ type: 'character', id: 'mark' }))
  await page.locator('.model-canvas[data-state=ready][data-character=mark]').waitFor()
  await page.getByRole('button', { name: '房间外观', exact: true }).click()
  await page.locator('.room-model[data-state=ready]').waitFor()
  assert.equal((await page.evaluate(async () => (await window.anna.invoke({ type: 'snapshot' })).snapshot)).settings.characterId, 'mark')
  evidence.checks.push('Selecting an original companion still loads its own model; room skin preserves selected identity')
  await page.screenshot({ path: 'artifacts/live2d-authoring/desktop-ui.png' })
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 680))
  await page.waitForTimeout(250)
  assert(await page.getByRole('button', { name: '发送 ↗', exact: true }).isVisible())
  const size = await page.evaluate(() => {
    const box = document.querySelector('.composer-actions > .primary').getBoundingClientRect()
    return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth, send: { right: box.right, bottom: box.bottom } }
  })
  assert.equal(size.overflow, false)
  assert(size.send.right <= size.width && size.send.bottom <= size.height, 'Send button is clipped')
  await page.screenshot({ path: 'artifacts/live2d-authoring/desktop-small.png' })
  evidence.checks.push('900 × 680 window: no horizontal overflow; send button stays in the viewport')
  assert.deepEqual(evidence.errors, [])
  console.log(JSON.stringify(evidence, null, 2))
}
finally {
  await writeFile('artifacts/live2d-authoring/desktop-ui-checks.json', `${JSON.stringify(evidence, null, 2)}\n`)
  await desktop.close()
}
