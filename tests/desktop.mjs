/* eslint-disable antfu/no-top-level-await, no-console -- This executable acceptance script owns its process lifecycle. */
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import electron from 'electron'
import { _electron } from 'playwright'

/** Real-model acceptance: a work task with tools, a real approval, the stage performing it, and session resume. */
const root = process.cwd()
await mkdir('.data', { recursive: true })
await mkdir('artifacts', { recursive: true })
const data = await mkdtemp(resolve('.data/e2e-'))
const workspace = join(data, 'project')
await mkdir(workspace)
await writeFile(join(workspace, 'tasks.txt'), 'Synthetic acceptance input: Anna website; Windows package; WeChat QR.\n')
const source = process.env.ANNA_CREDENTIAL_SOURCE ?? join(homedir(), '.local/share/anna-dsh')
await copyFile(join(source, 'credential.bin'), join(data, 'credential.bin'))
const previous = JSON.parse(await readFile(join(source, 'settings.json'), 'utf8'))
// Collaboration mode in a trusted folder: edits run freely, other commands (touch) ask.
const settings = { version: 2, kernel: 'pi', characterId: 'hiyori', statusEnabled: true, memoryEnabled: true, model: previous.model, workspace, workspaces: { [workspace]: { trusted: true, mode: 'edit', rules: { allow: [], ask: [], deny: [] } } } }
await writeFile(join(data, 'settings.json'), JSON.stringify(settings), { mode: 0o600 })
const evidence = { data, checks: [], phases: [], consoleErrors: [] }
let desktop

async function launch() {
  const packaged = process.env.ANNA_PACKAGED_APP
  desktop = await _electron.launch({ executablePath: packaged ? join(packaged, 'Contents/MacOS/Anna') : electron, args: packaged ? [] : ['dist/host/apps/desktop/main.js'], cwd: packaged ? '/' : root, env: { ...process.env, ANNA_DEV_URL: packaged ? 'http://127.0.0.1:9' : '', ANNA_TEST_CDP: '', ANNA_ROOT: packaged ? '/nonexistent/anna-source' : root, ANNA_DATA_DIR: data } })
  const page = await desktop.firstWindow()
  page.on('pageerror', e => evidence.consoleErrors.push(e.message))
  await page.locator('.scene').waitFor()
  await page.locator('.connection i.online').waitFor({ timeout: 60000 })
  await page.locator('.model-canvas[data-state="ready"]').waitFor({ timeout: 30000 })
  await page.evaluate(() => {
    window.__phases = []
    window.anna.subscribe(event => event.type === 'anna' && window.__phases.push(event.state.phase))
  })
  return page
}
async function snapshot(page) { const r = await page.evaluate(() => window.anna.invoke({ type: 'snapshot' })); assert(r.ok, r.error); return r.snapshot }
async function send(page, text, { approve } = {}) {
  const before = (await snapshot(page)).messages.length
  await page.getByRole('textbox', { name: '消息', exact: true }).fill(text)
  await page.getByRole('button', { name: '发送 ↗', exact: true }).click()
  const deadline = Date.now() + 240000
  let approved = 0
  for (;;) {
    const state = await snapshot(page)
    if (state.approvals.length && approve) {
      await page.screenshot({ path: 'artifacts/stage-approval.png' })
      evidence.approval = state.approvals[0]
      await page.getByRole('button', { name: '仅允许一次', exact: true }).first().click()
      approved++
    }
    if (state.state !== 'running' && state.messages.length >= before + 2)
      return { text: state.messages.at(-1).text, state, approved }
    if (state.state === 'error' || (state.error && state.state !== 'running'))
      throw new Error(state.error)
    if (Date.now() > deadline)
      throw new Error('Timed out waiting for Anna')
    if (state.state === 'running' && state.anna.phase !== 'waiting' && !evidence.workingShot) {
      evidence.workingShot = state.anna.phase
      await page.screenshot({ path: 'artifacts/stage-working.png' })
    }
    await page.waitForTimeout(400)
  }
}

try {
  let page = await launch()
  await page.screenshot({ path: 'artifacts/stage-idle.png' })
  const frame = await page.locator('.model-canvas canvas').screenshot()
  await page.waitForTimeout(750)
  assert(!frame.equals(await page.locator('.model-canvas canvas').screenshot()), 'Live2D idle animation did not advance')
  evidence.checks.push('Live2D loaded and animating')

  const work = await send(page, '这是工程验收构造输入。请实际读取当前工作目录 tasks.txt，然后用文件工具创建 result.md，内容包含 ANNA_WORK_OK 和输入中的三项任务。接着用终端运行 `touch approved.txt` 创建一个空文件（这一步需要我确认）。最后读取 result.md 核验，并回复完成情况。', { approve: true })
  const output = await readFile(join(workspace, 'result.md'), 'utf8')
  assert.match(output, /ANNA_WORK_OK/)
  assert.match(output, /Windows/)
  assert(work.approved >= 1, 'expected a real approval request for touch')
  await readFile(join(workspace, 'approved.txt'))
  assert(work.state.result?.files.some(file => file.includes('result.md')), JSON.stringify(work.state.result))
  evidence.work = { reply: work.text, result: work.state.result, approval: evidence.approval }
  evidence.phases = await page.evaluate(() => window.__phases)
  for (const phase of ['thinking', 'inspecting', 'editing', 'waiting', 'done'])
    assert(evidence.phases.includes(phase), `stage never performed ${phase}: ${evidence.phases.join(',')}`)
  await page.locator('.result-card').waitFor()
  await page.screenshot({ path: 'artifacts/stage-result.png' })
  evidence.checks.push('Real work task: read, write, approval-gated command, result card, stage phases')

  await page.getByRole('button', { name: '工作过程' }).click()
  await page.locator('.drawer .tool-events details').first().waitFor()
  await page.screenshot({ path: 'artifacts/stage-work-drawer.png' })
  await page.getByRole('button', { name: '关闭抽屉', exact: true }).click()

  const token = `槐树-${Date.now().toString().slice(-6)}`
  const status = await send(page, `调用你的状态工具，告诉我你现在的大脑和插件。另外请记住本次验收暗号是“${token}”。`)
  assert.match(JSON.stringify(status.state), /anna_status/)
  evidence.statusReply = status.text
  evidence.checks.push('anna_status tool called through pi customTools')
  const savedFile = (await snapshot(page)).settings.sessionFile
  assert(savedFile, 'session file not stored')

  await desktop.close()
  desktop = undefined
  page = await launch()
  let state = await snapshot(page)
  assert.equal(state.settings.sessionFile, savedFile)
  assert.equal(state.restored, true)
  assert.equal(state.mode, 'edit')
  const recalled = await send(page, '我之前让你记住的验收暗号是什么？请只回答暗号。')
  assert(recalled.text.includes(token), `Expected ${token} in ${recalled.text}`)
  evidence.checks.push('pi session resumed after full app exit (core process restarted); model recalled the token')
  state = await snapshot(page)
  await page.setViewportSize({ width: 900, height: 660 }).catch(() => {})
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 680))
  await page.screenshot({ path: 'artifacts/stage-small-window.png' })
  assert.deepEqual(evidence.consoleErrors, [])
  evidence.checks.push('No renderer page errors')
}
finally {
  if (desktop)
    await desktop.close()
  await writeFile('artifacts/acceptance.json', JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
}
