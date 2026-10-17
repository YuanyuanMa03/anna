/* eslint-disable antfu/no-top-level-await, no-console -- This executable acceptance script owns its process lifecycle. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import electron from 'electron'
import { _electron } from 'playwright'

/**
 * Deterministic desktop acceptance with a scripted model (no API key, runs in CI on macOS, Windows and Linux):
 * trust → modes and their stage reactions → approvals → result card, diff and undo → interruption → core crash recovery.
 */
const root = process.cwd()
await mkdir('.data', { recursive: true })
await mkdir('artifacts', { recursive: true })
const data = await mkdtemp(resolve('.data/scripted-'))
const workspace = join(data, 'project')
await mkdir(workspace)
await writeFile(join(workspace, 'tasks.txt'), 'alpha\nbeta\n')
const script = join(data, 'script.json')
await writeFile(script, JSON.stringify([
  { text: '你好，我是 Anna。' },
  { tools: [{ name: 'read', args: { path: 'tasks.txt' } }], wait: 400 },
  { tools: [{ name: 'edit', args: { path: 'tasks.txt', edits: [{ oldText: 'alpha', newText: 'ALPHA' }] } }], wait: 400 },
  { tools: [{ name: 'write', args: { path: 'notes.md', content: '# Notes\n' } }], wait: 300 },
  { text: '**改好了**，修改了 tasks.txt，新增了 notes.md。' },
  { text: '这一句会被打断。', wait: 6000 },
  { text: '继续正常工作。' },
]))
// Pretend the settings come from a previous key-configured install; the vault returns the scripted key.
await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'hiyori', statusEnabled: true, memoryEnabled: true, model: { provider: 'custom', model: 'scripted', baseURL: 'https://scripted.invalid', api: 'openai-completions' }, workspaces: {} }))
const evidence = { data, checks: [], consoleErrors: [] }
const env = { ...process.env, ANNA_DEV_URL: '', ANNA_ROOT: root, ANNA_DATA_DIR: data, ANNA_TEST_SCRIPT: script, ANNA_TEST_KEY: 'scripted', ANNA_TEST_FAKE_AGENT: resolve('tests/fixtures/fake-agent.mjs'), ANNA_TEST_NODE: process.execPath, ANNA_FAKE_DELAY: '1500' }
const packaged = process.env.ANNA_PACKAGED_APP
const executablePath = !packaged ? electron : process.platform === 'darwin' ? join(packaged, 'Contents/MacOS/Anna') : process.platform === 'win32' ? join(packaged, 'Anna.exe') : join(packaged, 'anna')
const desktop = await _electron.launch({ executablePath, args: packaged ? [] : ['dist/host/apps/desktop/main.js'], cwd: packaged ? '/' : root, env: packaged ? { ...env, ANNA_ROOT: '/nonexistent/anna-source', ANNA_DEV_URL: 'http://127.0.0.1:9' } : env })
if (process.env.ANNA_TEST_VERBOSE)
  desktop.process().stderr.on('data', chunk => process.stderr.write(`[app] ${chunk}`))
const snapshot = async page => (await page.evaluate(() => window.anna.invoke({ type: 'snapshot' }))).snapshot
async function until(page, predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const state = await snapshot(page)
    if (state && predicate(state))
      return state
    if (Date.now() > deadline)
      throw new Error(`Timed out: ${label} (${JSON.stringify({ state: state?.state, error: state?.error, anna: state?.anna })})`)
    await page.waitForTimeout(150)
  }
}
try {
  const page = await desktop.firstWindow()
  page.on('pageerror', e => evidence.consoleErrors.push(e.message))
  await page.locator('.scene').waitFor()
  await page.locator('.model-canvas[data-state="ready"]').waitFor({ timeout: 30000 })

  // Pick the project folder: unknown folders wait for a trust decision before anything loads.
  await page.evaluate(path => window.anna.invoke({ type: 'workspace', path }), workspace)
  await page.locator('.trust-card').waitFor()
  assert.equal(await page.locator('.mode-switch button[data-mode="auto"]').isDisabled(), true)
  await page.screenshot({ path: 'artifacts/scripted-trust.png' })
  await page.getByRole('button', { name: '信任并开始', exact: true }).click()
  await until(page, s => s.state === 'ready' && s.workspace.trusted, 'trusted and connected')
  evidence.checks.push('Unknown folder asks for trust first; auto mode disabled until trusted')

  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送 ↗', exact: true }).click()
  await until(page, s => s.state === 'ready' && s.messages?.length === 2, 'greeting')

  // Switch to ask mode: Anna tilts her head (stricter) and greets the change.
  await page.locator('.mode-switch button[data-mode="ask"]').click()
  await page.locator('.model-canvas[data-mode="ask"][data-gesture="tilt"]').waitFor({ timeout: 3000 })
  await page.locator('.bubble').getByText('每次要动手之前我都会先问你').waitFor()
  await page.screenshot({ path: 'artifacts/scripted-mode-ask.png' })
  evidence.checks.push('Mode change: stance + tilt gesture + spoken greeting')

  await page.getByRole('textbox', { name: '消息', exact: true }).fill('整理 tasks.txt')
  await page.getByRole('button', { name: '发送 ↗', exact: true }).click()
  await page.locator('.approval-request').waitFor({ timeout: 15000 })
  assert.equal(await page.locator('.model-canvas').getAttribute('data-performed') !== null, true)
  await page.screenshot({ path: 'artifacts/scripted-approval.png' })
  await page.getByRole('button', { name: '本次会话都允许', exact: true }).click()
  await page.locator('.approval-request').waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: '仅允许一次', exact: true }).click()
  const done = await until(page, s => s.state === 'ready' && s.result?.taskId, 'task done')
  assert.deepEqual(done.result.changes.map(c => `${c.status}:${c.path}`).sort(), ['added:notes.md', 'modified:tasks.txt'])
  assert.deepEqual(done.sessionRules, ['Edit(tasks.txt)'])
  await page.locator('.result-card').waitFor()
  assert.match(await page.locator('.bubble strong').first().textContent(), /改好了/)
  await page.screenshot({ path: 'artifacts/scripted-result.png' })
  evidence.checks.push('Ask mode: approvals with session scope, result card with changes, Markdown bubble')

  await page.getByRole('button', { name: '查看改动', exact: true }).click()
  await page.locator('pre.diff .add').first().waitFor()
  await page.screenshot({ path: 'artifacts/scripted-diff.png' })
  await page.getByRole('button', { name: '关闭抽屉', exact: true }).click()
  await page.getByRole('button', { name: '撤销这次改动', exact: true }).click()
  await page.getByRole('button', { name: '确认撤销', exact: true }).click()
  await until(page, s => s.result?.undone, 'undone')
  assert.equal(await readFile(join(workspace, 'tasks.txt'), 'utf8'), 'alpha\nbeta\n')
  assert.equal(existsSync(join(workspace, 'notes.md')), false)
  evidence.checks.push('Diff drawer and undo restored the workspace')

  // Auto mode: a nod. Then interrupt a slow turn: no error, an interruption note, next turn fine.
  await page.locator('.mode-switch button[data-mode="auto"]').click()
  await page.locator('.model-canvas[data-mode="auto"][data-gesture="nod"]').waitFor({ timeout: 3000 })
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('慢慢想')
  await page.getByRole('button', { name: '发送 ↗', exact: true }).click()
  await until(page, s => s.state === 'running', 'running')
  await page.getByRole('button', { name: '中断本轮', exact: true }).click()
  const stopped = await until(page, s => s.state === 'ready', 'stopped')
  assert.equal(stopped.error, undefined)
  assert.equal(stopped.result.status, 'aborted')
  assert.equal(await page.locator('.dock .error').count(), 0)
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('继续')
  await page.getByRole('button', { name: '发送 ↗', exact: true }).click()
  await until(page, s => s.state === 'ready' && s.messages?.at(-1)?.text === '继续正常工作。', 'after interruption')
  evidence.checks.push('Interruption is not an error; the next turn works')

  // Delegate to an external agent: the collaborator card appears, Anna supervises, the result lands in the history.
  await page.getByRole('button', { name: /外部 agent/ }).click()
  await page.locator('.agents .agent-list li[data-agent="claude"]').waitFor()
  await page.screenshot({ path: 'artifacts/scripted-agents.png' })
  await page.getByRole('button', { name: '关闭外部 agent', exact: true }).click()
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('@claude 帮我创建 done.txt')
  await page.getByRole('button', { name: '发送 ↗', exact: true }).click()
  await page.locator('.collaborator-card[data-agent="claude"][data-state="running"]').waitFor({ timeout: 10000 })
  await page.locator('.model-canvas[data-performed="supervising"]').waitFor({ timeout: 5000 })
  await page.screenshot({ path: 'artifacts/scripted-delegation.png' })
  const delegated = await until(page, s => s.state === 'ready' && s.messages?.at(-1)?.delegation?.agent === 'claude', 'delegation done')
  assert.equal(await readFile(join(workspace, 'done.txt'), 'utf8'), 'OK')
  assert.deepEqual(delegated.result.changes.map(c => c.path), ['done.txt'])
  await page.locator('.collaborator-card[data-state="done"]').waitFor()
  evidence.checks.push('Delegation: @claude via the fake agent, collaborator card, supervising pose, history block, changes')

  // Kill the core process: main restarts it and the window reconnects without losing the session.
  const sessionId = (await snapshot(page)).sessionId
  const metrics = await desktop.evaluate(({ app }) => app.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type, name: metric.name, serviceName: metric.serviceName })))
  const pid = metrics.find(metric => metric.type === 'Utility' && (metric.name === 'Anna Core' || metric.serviceName === 'Anna Core'))?.pid
  evidence.metrics = metrics
  assert(pid, 'core process not found')
  process.kill(pid, 'SIGKILL')
  await page.waitForTimeout(500)
  const recovered = await until(page, s => s.state === 'ready' && s.sessionId === sessionId, 'core recovered', 30000)
  assert.equal(recovered.messages?.at(-1)?.delegation?.agent, 'claude')
  evidence.checks.push('Core crash: restarted by main, session and history intact')
  await page.screenshot({ path: 'artifacts/scripted-recovered.png' })
  assert.deepEqual(evidence.consoleErrors, [])
}
finally {
  await desktop.close()
  await writeFile('artifacts/scripted-acceptance.json', JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
}
