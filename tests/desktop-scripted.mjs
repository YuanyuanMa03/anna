/* eslint-disable antfu/no-top-level-await, no-console -- This executable acceptance script owns its process lifecycle. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import electron from 'electron'
import { _electron } from 'playwright'
import { assertBuiltAssets } from './built-assets.mjs'

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
  { tools: [{ name: 'read', args: { path: 'done.txt' } }], wait: 1500 },
  { text: '我核实过了：done.txt 已创建，内容是 OK，可以放心用。' },
]))
// Pretend the settings come from a previous key-configured install; the vault returns the scripted key.
await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'haru', statusEnabled: true, memoryEnabled: true, model: { provider: 'custom', model: 'scripted', baseURL: 'https://scripted.invalid', api: 'openai-completions' }, workspaces: {} }))
const evidence = { data, checks: [], consoleErrors: [] }
const env = { ...process.env, ANNA_DEV_URL: '', ANNA_ROOT: root, ANNA_DATA_DIR: data, ANNA_TEST_SCRIPT: script, ANNA_TEST_KEY: 'scripted', ANNA_TEST_FAKE_AGENT: resolve('tests/fixtures/fake-agent.mjs'), ANNA_TEST_NODE: process.execPath, ANNA_FAKE_DELAY: '1500' }
const packaged = process.env.ANNA_PACKAGED_APP
if (!packaged)
  assertBuiltAssets(root)
const executablePath = !packaged ? electron : process.platform === 'darwin' ? join(packaged, 'Contents/MacOS/Anna') : process.platform === 'win32' ? join(packaged, 'Anna.exe') : join(packaged, 'anna')
// GitHub's Ubuntu runners block the unprivileged user namespaces Chromium's sandbox needs, and have no GPU:
// render WebGL (the Live2D canvas) in software. The packaged app's launcher decides about the sandbox on its own.
const chromium = process.platform === 'linux' && process.env.CI ? [...(packaged ? [] : ['--no-sandbox']), '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []
const desktop = await _electron.launch({ executablePath, args: [...chromium, ...(packaged ? [] : ['dist/host/apps/desktop/main.js'])], cwd: packaged ? '/' : root, env: packaged ? { ...env, ANNA_ROOT: '/nonexistent/anna-source', ANNA_DEV_URL: 'http://127.0.0.1:9' } : env })
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
  // ANNA_EXPECT_SANDBOX=1|0: check whether the app runs with Chromium's sandbox (the Linux launcher's choice).
  if (process.env.ANNA_EXPECT_SANDBOX) {
    const sandboxed = !(await desktop.evaluate(({ app }) => app.commandLine.hasSwitch('no-sandbox')))
    assert.equal(sandboxed, process.env.ANNA_EXPECT_SANDBOX === '1', `Chromium sandbox ${sandboxed ? 'on' : 'off'}`)
    evidence.sandboxed = sandboxed
    evidence.checks.push(`Chromium sandbox ${sandboxed ? 'on' : 'off'}, as expected`)
  }
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
  assert.deepEqual(done.sessionRules, ['Edit(./tasks.txt)'])
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
  // Providers, cc-switch style: add DeepSeek for Codex from the presets, let Anna use it, rename it, delete it.
  await page.getByRole('tab', { name: '服务商', exact: true }).click()
  await page.locator('.app-tabs button[data-app="codex"]').click()
  await page.getByRole('button', { name: '＋ 添加服务商', exact: true }).click()
  await page.getByRole('searchbox', { name: '搜索预设', exact: true }).fill('deepseek')
  await page.screenshot({ path: 'artifacts/scripted-provider-presets.png' })
  await page.locator('.preset-item[data-preset="DeepSeek"]').click()
  assert.equal(await page.getByRole('textbox', { name: '请求地址', exact: true }).inputValue(), 'https://api.deepseek.com')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await until(page, s => s.agents.mine.codex?.some(p => p.name === 'DeepSeek' && p.model === 'deepseek-flash' && !p.hasKey), 'DeepSeek added')
  await page.locator('.provider-list li[data-provider="DeepSeek"]').getByRole('button', { name: /^让.+用它$/ }).click()
  await until(page, s => s.agents.providers.codex?.provider === 'DeepSeek', 'DeepSeek in use')
  // The tray follows: Codex's submenu shows DeepSeek checked.
  const trayCodex = (await desktop.evaluate(() => globalThis.annaTrayMenu())).find(item => item.label?.startsWith('Codex'))
  assert.equal(trayCodex?.label, 'Codex：DeepSeek')
  assert.deepEqual(trayCodex.submenu.filter(item => item.type === 'radio').map(item => [item.label, item.checked]), [['它自己的登录', false], ['DeepSeek', true]])
  await page.screenshot({ path: 'artifacts/scripted-providers.png' })
  await page.locator('.provider-list li[data-provider="DeepSeek"]').getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByRole('textbox', { name: '服务商名称', exact: true }).fill('DeepSeek 工作')
  await page.getByRole('textbox', { name: '模型', exact: true }).fill('deepseek-v4-pro')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await until(page, s => s.agents.providers.codex?.provider === 'DeepSeek 工作' && s.agents.mine.codex?.[0]?.model === 'deepseek-v4-pro', 'renamed, still in use')
  await page.locator('.provider-list li[data-provider="DeepSeek 工作"]').getByRole('button', { name: '删除', exact: true }).click()
  await page.locator('.provider-list .approval-request').getByRole('button', { name: '删除', exact: true }).click()
  await until(page, s => !s.agents.mine.codex?.length && !s.agents.providers.codex?.provider, 'deleted, back to its own login')
  assert.equal((await desktop.evaluate(() => globalThis.annaTrayMenu())).some(item => item.label?.startsWith('Codex')), false)
  // A Chat Completions preset for Codex: labelled as routed, the editor picks Chat, no global switch.
  await page.getByRole('button', { name: '＋ 添加服务商', exact: true }).click()
  await page.getByRole('searchbox', { name: '搜索预设', exact: true }).fill('ppio')
  assert.match(await page.locator('.preset-item[data-preset="PPIO"]').textContent(), /经本地路由/)
  await page.locator('.preset-item[data-preset="PPIO"]').click()
  assert.equal(await page.getByRole('combobox', { name: '接口格式', exact: true }).inputValue(), 'openai_chat')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await until(page, s => s.agents.mine.codex?.some(p => p.name === 'PPIO' && p.routed), 'routed provider added')
  const routed = page.locator('.provider-list li[data-provider="PPIO"]')
  await routed.getByText('经本地路由', { exact: true }).waitFor()
  assert.equal(await routed.getByRole('button', { name: '应用到全局', exact: true }).isDisabled(), true)
  await page.screenshot({ path: 'artifacts/scripted-provider-routed.png' })
  await routed.getByRole('button', { name: '删除', exact: true }).click()
  await page.locator('.provider-list .approval-request').getByRole('button', { name: '删除', exact: true }).click()
  await until(page, s => !s.agents.mine.codex?.length, 'routed provider deleted')
  evidence.checks.push('A Chat Completions preset for Codex is labelled as routed and cannot be applied globally')
  // Claude Code too: Groq's Chat preset, and the editor offers both formats.
  await page.locator('.app-tabs button[data-app="claude"]').click()
  await page.getByRole('button', { name: '＋ 添加服务商', exact: true }).click()
  await page.getByRole('searchbox', { name: '搜索预设', exact: true }).fill('groq')
  await page.locator('.preset-item[data-preset="Groq"]').click()
  assert.equal(await page.getByRole('combobox', { name: '接口格式', exact: true }).inputValue(), 'openai_chat')
  assert.deepEqual(await page.getByRole('combobox', { name: '接口格式', exact: true }).locator('option').allTextContents(), ['Anthropic Messages（直连）', 'Chat Completions（经本地路由）'])
  await page.screenshot({ path: 'artifacts/scripted-provider-routed-claude.png' })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await until(page, s => s.agents.mine.claude?.some(p => p.name === 'Groq' && p.routed), 'routed Claude Code provider added')
  const groq = page.locator('.provider-list li[data-provider="Groq"]')
  assert.equal(await groq.getByRole('button', { name: '应用到全局', exact: true }).isDisabled(), true)
  await groq.getByRole('button', { name: '删除', exact: true }).click()
  await page.locator('.provider-list .approval-request').getByRole('button', { name: '删除', exact: true }).click()
  await until(page, s => !s.agents.mine.claude?.length, 'routed Claude Code provider deleted')
  evidence.checks.push('A Chat Completions preset for Claude Code is labelled as routed; the editor offers its native format and Chat')
  // A universal provider: one gateway for Claude Code and Codex at once, linked under each app.
  await page.locator('.app-tabs button[data-app="universal"]').click()
  await page.getByRole('button', { name: '＋ 添加统一服务商', exact: true }).click()
  await page.getByRole('textbox', { name: '统一服务商名称', exact: true }).fill('NewAPI')
  await page.getByRole('textbox', { name: '网关地址', exact: true }).fill('https://gw.example.com')
  await page.getByRole('checkbox', { name: '用在 Gemini CLI', exact: true }).uncheck()
  await page.getByRole('textbox', { name: 'Codex 模型', exact: true }).fill('gpt-5.6')
  await page.screenshot({ path: 'artifacts/scripted-universal-form.png' })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await until(page, s => s.agents.universal?.[0]?.name === 'NewAPI' && s.agents.mine.codex?.[0]?.baseUrl === 'https://gw.example.com/v1' && s.agents.mine.claude?.length === 1 && !s.agents.mine.gemini?.length, 'universal provider linked')
  await page.locator('.app-tabs button[data-app="codex"]').click()
  await page.locator('.provider-list li[data-provider="NewAPI"]').getByRole('button', { name: '在“统一”里修改', exact: true }).waitFor()
  await page.screenshot({ path: 'artifacts/scripted-universal-linked.png' })
  await page.locator('.app-tabs button[data-app="universal"]').click()
  await page.locator('.provider-list li[data-universal="NewAPI"]').getByRole('button', { name: '删除', exact: true }).click()
  await page.locator('.provider-list .approval-request').getByRole('button', { name: '删除', exact: true }).click()
  await until(page, s => !s.agents.universal?.length && !s.agents.mine.codex?.length && !s.agents.mine.claude?.length, 'universal deleted')
  // An "Import to CC Switch" link, pasted: a confirmation card with the key masked, then the provider and its key.
  await page.locator('.app-tabs button[data-app="claude"]').click()
  await page.getByRole('button', { name: '从链接导入', exact: true }).click()
  await page.getByRole('textbox', { name: '导入链接', exact: true }).fill(`ccswitch://v1/import?${new URLSearchParams({ resource: 'provider', app: 'claude', name: 'Example AI', endpoint: 'https://api.example.com', apiKey: 'sk-example-123456', model: 'example-sonnet', homepage: 'https://example.com' })}`)
  await page.getByRole('button', { name: '识别', exact: true }).click()
  await page.locator('.link-confirm').waitFor()
  assert((await page.locator('.link-confirm').textContent()).includes('sk-e••••3456'))
  await page.waitForTimeout(500) // let the card finish rising before the screenshot
  await page.screenshot({ path: 'artifacts/scripted-link-import.png' })
  await page.locator('.link-confirm').getByRole('button', { name: '导入', exact: true }).click()
  await until(page, s => !s.agents.pendingImport && s.agents.mine.claude?.[0]?.name === 'Example AI' && s.agents.mine.claude[0].baseUrl === 'https://api.example.com', 'link imported')
  await page.locator('.provider-list li[data-provider="Example AI"]').getByRole('button', { name: '删除', exact: true }).click()
  await page.locator('.provider-list .approval-request').getByRole('button', { name: '删除', exact: true }).click()
  await until(page, s => !s.agents.mine.claude?.length, 'imported provider deleted')
  await page.getByRole('tab', { name: 'Agent', exact: true }).click()
  evidence.checks.push('Providers: DeepSeek added from the Codex presets, used by Anna, renamed and re-modelled in place, deleted; a universal gateway linked under Claude Code and Codex (Codex with /v1), then deleted; an import link previewed with the key masked and imported')
  await page.getByRole('button', { name: '关闭外部 agent', exact: true }).click()
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('@claude 帮我创建 done.txt')
  await page.getByRole('button', { name: '发送 ↗', exact: true }).click()
  await page.locator('.collaborator-card[data-agent="claude"][data-state="running"]').waitFor({ timeout: 10000 })
  await page.locator('.model-canvas[data-performed="supervising"]').waitFor({ timeout: 5000 })
  await page.screenshot({ path: 'artifacts/scripted-delegation.png' })
  // The companion then reviews the collaborator's result in a hidden turn and reports her own verdict.
  await page.locator('.model-canvas[data-performed="reviewing"]').waitFor({ timeout: 10000 })
  await page.locator('.collaborator-card[data-state="done"]').waitFor()
  await page.screenshot({ path: 'artifacts/scripted-review.png' })
  const reviewed = '我核实过了：done.txt 已创建，内容是 OK，可以放心用。'
  const delegated = await until(page, s => s.state === 'ready' && s.messages?.at(-1)?.text === reviewed, 'delegation reviewed')
  assert.equal(delegated.messages.at(-2)?.delegation?.agent, 'claude')
  assert(!delegated.messages.some(m => m.role === 'user' && m.text.includes('Anna 系统提示')), 'review prompt leaked into the transcript')
  assert.equal(await readFile(join(workspace, 'done.txt'), 'utf8'), 'OK')
  assert.deepEqual(delegated.result.changes.map(c => c.path), ['done.txt'])
  evidence.checks.push('Delegation: @claude via the fake agent, collaborator card, supervising pose, history block, changes, hidden review with reviewing pose')

  // Kill the core process: main restarts it and the window reconnects without losing the session.
  const sessionId = (await snapshot(page)).sessionId
  const metrics = await desktop.evaluate(({ app }) => app.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type, name: metric.name, serviceName: metric.serviceName })))
  const pid = metrics.find(metric => metric.type === 'Utility' && (metric.name === 'Anna Core' || metric.serviceName === 'Anna Core'))?.pid
  evidence.metrics = metrics
  assert(pid, 'core process not found')
  process.kill(pid, 'SIGKILL')
  await page.waitForTimeout(500)
  const recovered = await until(page, s => s.state === 'ready' && s.sessionId === sessionId, 'core recovered', 30000)
  assert.equal(recovered.messages?.at(-2)?.delegation?.agent, 'claude')
  assert.equal(recovered.messages?.at(-1)?.text, reviewed)
  evidence.checks.push('Core crash: restarted by main, session and history intact')
  await page.screenshot({ path: 'artifacts/scripted-recovered.png' })
  assert.deepEqual(evidence.consoleErrors, [])
}
finally {
  await desktop.close()
  await writeFile('artifacts/scripted-acceptance.json', JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
}
