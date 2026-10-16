/* eslint-disable antfu/no-top-level-await, no-console -- This executable acceptance script owns its process lifecycle. */
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import electron from 'electron'
import { _electron } from 'playwright'

const root = process.cwd()
await mkdir('.data', { recursive: true })
await mkdir('artifacts', { recursive: true })
const data = await mkdtemp(resolve('.data/e2e-'))
const source = process.env.ANNA_CREDENTIAL_SOURCE ?? join(homedir(), '.local/share/anna-dsh')
await copyFile(join(source, 'credential.bin'), join(data, 'credential.bin'))
const settings = JSON.parse(await readFile(join(source, 'settings.json'), 'utf8'))
delete settings.sessionId
settings.characterId = 'hiyori'
settings.statusEnabled = true
await writeFile(join(data, 'settings.json'), JSON.stringify(settings), { mode: 0o600 })
const evidence = { data, checks: [], consoleErrors: [] }
let desktop
async function launch() {
  desktop = await _electron.launch({ executablePath: electron, args: ['dist/host/apps/desktop/main.js'], cwd: root, env: { ...process.env, ANNA_DEV_URL: '', ANNA_TEST_CDP: '', ANNA_ROOT: root, ANNA_DATA_DIR: data } })
  const page = await desktop.firstWindow()
  page.on('pageerror', e => evidence.consoleErrors.push(e.message))
  await page.locator('.main-layout').waitFor()
  await page.locator('.connection i.online').waitFor({ timeout: 60000 })
  const state = await snapshot(page)
  assert.equal(state.state, 'ready', state.error ?? 'Unexpected runtime state')
  return page
}
async function snapshot(page) { const r = await page.evaluate(() => window.anna.invoke({ type: 'snapshot' })); assert(r.ok, r.error); return r.snapshot }
async function send(page, text) {
  const before = (await snapshot(page)).messages.length
  await page.getByRole('textbox', { name: '消息', exact: true }).fill(text)
  await page.getByRole('button', { name: '发送 ↗', exact: true }).click()
  await page.locator('.message.assistant').nth(Math.floor(before / 2)).waitFor({ timeout: 180000 })
  await page.locator('button[type=submit]').waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('textarea')?.disabled)
  const state = await snapshot(page)
  assert.equal(state.state, 'ready', state.error ?? 'Unexpected runtime state')
  assert.equal(state.messages.at(-1).role, 'assistant')
  return state.messages.at(-1).text
}
async function childPid() { return JSON.parse(await readFile(join(data, 'receipts/anna-persona.json'), 'utf8')).pid }
function assertExited(pid) { assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }) }
try {
  let page = await launch()
  for (const name of ['Hiyori', 'Haru', 'Mark']) {
    await page.getByRole('button', { name: `选择 ${name}`, exact: true }).click()
    await page.locator(`.model-canvas[data-character="${name.toLowerCase()}"][data-state="ready"]`).waitFor({ timeout: 30000 })
    await page.screenshot({ path: `artifacts/character-${name.toLowerCase()}.png` })
    const frame = await page.locator('.model-canvas canvas').screenshot()
    await page.waitForTimeout(750)
    const nextFrame = await page.locator('.model-canvas canvas').screenshot()
    assert(!frame.equals(nextFrame), `${name} idle animation did not advance`)
    evidence.checks.push(`${name}: actual Live2D loaded and animation advanced`)
  }
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 680))
  await page.screenshot({ path: 'artifacts/mark-small-window.png' })
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 860))
  const greeting = await send(page, 'Anna，你好，介绍一下你自己。')
  assert.match(greeting, /Anna/i)
  evidence.greeting = greeting
  evidence.checks.push('B: real model greeting through DSH')
  const token = `槐树-${Date.now().toString().slice(-6)}`
  const statusReply = await send(page, `Anna，调用你的状态工具，检查你现在加载了什么插件。另外请记住本次验收暗号是“${token}”。`)
  evidence.statusReply = statusReply
  await page.locator('.tool-events').click()
  assert.match(await page.locator('.tool-events').textContent(), /anna_status/)
  assert.match(await page.locator('.tool-events').textContent(), /anna-persona/)
  await page.screenshot({ path: 'artifacts/real-tool-result.png' })
  evidence.checks.push('C: real anna_status call and result visible')
  const savedId = (await snapshot(page)).sessionId
  const oldPid = await childPid()
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByRole('button', { name: '禁用状态工具', exact: true }).click()
  await page.getByRole('button', { name: '启用状态工具', exact: true }).click({ trial: true, timeout: 60000 })
  let state = await snapshot(page)
  assert.equal(state.state, 'ready', state.error ?? 'Unexpected runtime state')
  assert.deepEqual(state.tools, [])
  assert.deepEqual(state.plugins, ['anna-persona'])
  assert.equal(state.sessionId, savedId)
  assert.equal(state.restored, true)
  assertExited(oldPid)
  await page.screenshot({ path: 'artifacts/status-disabled.png' })
  const disabledReply = await page.getByRole('button', { name: '关闭插件', exact: true }).click().then(() => send(page, '你现在可以调用 anna_status 吗？如果没有注册，请如实说明，不要编造结果。'))
  evidence.disabledReply = disabledReply
  assert.deepEqual((await snapshot(page)).tools, [])
  assert.equal(await page.locator('.tool-events').count(), 0)
  assert.match(disabledReply, /未|不能|没有|不可用/)
  assert.match(await page.locator('.messages').textContent(), /本轮没有实际工具调用/)
  const disabledPid = await childPid()
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByRole('button', { name: '启用状态工具', exact: true }).click()
  await page.getByRole('button', { name: '禁用状态工具', exact: true }).click({ trial: true, timeout: 60000 })
  state = await snapshot(page)
  assert.equal(state.state, 'ready', state.error ?? 'Unexpected runtime state')
  assert.deepEqual(state.tools, ['anna_status'])
  assert.equal(state.sessionId, savedId)
  assertExited(disabledPid)
  await page.screenshot({ path: 'artifacts/status-enabled.png' })
  await page.getByRole('button', { name: '关闭插件', exact: true }).click()
  evidence.checks.push('D: enabled → disabled → enabled, verified runtime schemas and child exit')
  const exitPid = await childPid()
  await desktop.close()
  desktop = undefined
  assertExited(exitPid)
  page = await launch()
  state = await snapshot(page)
  assert.equal(state.settings.characterId, 'mark')
  assert.equal(state.sessionId, savedId)
  assert.equal(state.restored, true)
  const restoredReply = await send(page, '我之前让你记住的验收暗号是什么？请只回答暗号。')
  assert(restoredReply.includes(token), `Expected ${token} in ${restoredReply}`)
  evidence.restoredReply = restoredReply
  evidence.sessionId = savedId
  evidence.checks.push('E: real session resume, model recalled prior token after complete app exit')
  await page.screenshot({ path: 'artifacts/session-restored.png' })
  assert.deepEqual(evidence.consoleErrors, [])
  evidence.checks.push('No renderer page errors')
  const finalPid = await childPid()
  await desktop.close()
  desktop = undefined
  assertExited(finalPid)
  evidence.checks.push('SDK child reaped on app exit')
}
finally {
  if (desktop)
    await desktop.close()
  await writeFile('artifacts/acceptance.json', JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
}
