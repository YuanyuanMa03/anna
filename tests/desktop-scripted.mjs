/* eslint-disable antfu/no-top-level-await, no-console -- This executable acceptance script owns its process lifecycle. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { _electron } from 'playwright'
import { desktopLaunch } from './desktop-launch.mjs'

/** The voice controls live in Anna 档案 → 3 接通模型 → 她的声音. */
async function voiceControl(page, name) {
  await page.locator('.brain-chip').click()
  const sheet = page.getByRole('dialog', { name: 'Anna 档案' })
  await sheet.getByRole('button', { name: '3 接通模型', exact: true }).click()
  await sheet.getByRole('button', { name, exact: true }).click()
  if (name !== '语音设置')
    await sheet.getByRole('button', { name: '关闭设置', exact: true }).click()
}

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
await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, onboardingComplete: true, kernel: 'pi', characterId: 'haru', statusEnabled: true, memoryEnabled: true, model: { provider: 'custom', model: 'scripted', baseURL: 'https://scripted.invalid', api: 'openai-completions' }, workspaces: {} }))
const evidence = { data, checks: [], consoleErrors: [] }
const env = { ...process.env, ANNA_DEV_URL: '', ANNA_ROOT: root, ANNA_DATA_DIR: data, ANNA_TEST_SCRIPT: script, ANNA_TEST_KEY: 'scripted', ANNA_ACP: '1', ANNA_TEST_FAKE_AGENT: resolve('tests/fixtures/fake-agent.mjs'), ANNA_TEST_NODE: process.execPath, ANNA_FAKE_DELAY: '1500' }
let recognitionReads = 0
const voiceServer = createServer((req, res) => {
  // Recognition goes through the chat protocol, as Xiaomi MiMo does; synthesis below keeps the OpenAI audio protocol.
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    recognitionReads++
    assert.equal(req.headers['content-type'], 'application/json')
    assert.equal(req.headers.authorization, 'Bearer fixture-asr-key')
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      assert.equal(body.model, 'fixture-asr')
      assert.match(body.messages[0].content[0].input_audio.data, /^data:audio\/wav;base64,UklGR/)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '合成录音用于验证语音链路。' } }] }))
    })
    return
  }
  if (req.url !== '/v1/audio/speech' || req.method !== 'POST') { res.writeHead(404); res.end(); return }
  req.resume()
  // Synthetic one-second WAV: silence, a tone, then silence. Never play to a physical output.
  const wav = Buffer.alloc(32044)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(32000, 40)
  for (let sample = 3200; sample < 9600; sample++)
    wav.writeInt16LE(Math.round(Math.sin(sample * Math.PI * 2 * 220 / 16000) * 8000), 44 + sample * 2)
  res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(wav)
})
await new Promise(resolve => voiceServer.listen(0, '127.0.0.1', resolve))
const voicePort = voiceServer.address().port
const packaged = process.env.ANNA_PACKAGED_APP
const desktop = await _electron.launch(desktopLaunch(data, env))
let processErrors = ''
desktop.process().stderr.on('data', (chunk) => { processErrors = (processErrors + chunk.toString()).slice(-32000) })
if (process.env.ANNA_TEST_VERBOSE)
  desktop.process().stderr.on('data', chunk => process.stderr.write(`[app] ${chunk}`))
const snapshot = async page => (await page.evaluate(() => window.anna.invoke({ type: 'snapshot' }))).snapshot
/** Opens one of the places behind the corner menu. */
async function menu(page, name) {
  await page.getByRole('button', { name: '更多', exact: true }).click()
  await page.locator('.menu-list').getByRole('button', { name }).click()
}
async function until(page, predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const state = await snapshot(page)
    if (state && predicate(state))
      return state
    if (Date.now() > deadline)
      throw new Error(`Timed out: ${label} (${JSON.stringify({ state: state?.state, error: state?.error, anna: state?.anna, routing: state?.agents?.global?.codex?.routing })})`)
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
  // Anna's own body is what a fresh start shows; the anime form is one click away.
  if (!packaged) {
    assert.equal(await page.locator('.model-canvas').getAttribute('data-renderer'), 'mesh')
    evidence.checks.push('Stage: her own body (mesh avatar)')
    // The room behind her really loads: a broken URL in a CSS background fails silently.
    assert.equal(await page.evaluate(async () => {
      const url = getComputedStyle(document.querySelector('.app-shell')).backgroundImage.match(/url\("([^"]*room[^"]*)"\)/)?.[1]
      const room = new Image()
      room.src = url
      await room.decode()
      return room.naturalWidth > 0
    }), true)
    evidence.checks.push('Stage: the room is behind her')
    // Image pixels of her current art (1672 × 941; update with the art) to the window: a pat on her hair, then a
    // double click once the 2.5 s poke window has passed, so its two clicks are not taken for pokes three and four.
    const canvas = await page.locator('.body-stage canvas').boundingBox()
    const at = (x, y) => ({ x: canvas.x + x * canvas.width / 1672, y: canvas.y + y * canvas.height / 941 })
    const hair = at(840, 120)
    await page.mouse.click(hair.x, hair.y)
    await page.locator('.body-stage[data-motion="giggle"][data-expression="shy"]').waitFor({ timeout: 3000 })
    await page.waitForTimeout(2600)
    await page.mouse.dblclick(hair.x, hair.y)
    await page.locator('.body-stage[data-motion="wink"]').waitFor({ timeout: 3000 })
    await menu(page, '外观与能力')
    await page.locator('.form-row').getByRole('button', { name: '二次元', exact: true }).click()
    await page.locator('.model-canvas[data-renderer="live2d"][data-state="ready"]').waitFor({ timeout: 20000 })
    await page.locator('.form-row').getByRole('button', { name: '本体', exact: true }).click()
    await page.locator('.model-canvas[data-renderer="mesh"][data-state="ready"]').waitFor({ timeout: 20000 })
    await page.getByRole('button', { name: '关闭外观与能力' }).click()
    evidence.checks.push('Her body: a pat on the hair makes her shy, a double click winks, and the anime form switches in and back')
    // The person makes their own Anna from a picture: five marks, and she stands there; a reload keeps her.
    await menu(page, '创造我的 Anna')
    await page.locator('.avatar-maker input[type=file]').setInputFiles(join(root, 'artwork/anna-body/source.png'))
    await page.locator('.mark-area img').waitFor()
    const picture = await page.locator('.mark-area img').boundingBox()
    for (const [x, y] of [[778, 298], [885, 316], [816, 394], [816, 445], [840, 35]])
      await page.mouse.click(picture.x + x * picture.width / 1672, picture.y + y * picture.height / 941)
    await page.getByRole('button', { name: '做成我的 Anna' }).click()
    await page.locator('.body-stage[data-avatar="mine"][data-state="ready"]').waitFor({ timeout: 30000 })
    await page.reload()
    await page.locator('.body-stage[data-avatar="mine"][data-state="ready"]').waitFor({ timeout: 30000 })
    evidence.checks.push('Make your own: a picture and five marks become her, and a reload keeps it')
    // A finished archive works too, a broken one says why, and forgetting it brings her own body back.
    await menu(page, '创造我的 Anna')
    await page.locator('.avatar-maker input[type=file]').setInputFiles({ name: 'broken.mavatar', mimeType: 'application/zip', buffer: Buffer.from('not an archive') })
    await page.locator('.avatar-maker .error').waitFor()
    await page.locator('.avatar-maker input[type=file]').setInputFiles(join(root, 'assets/anna-body/anna.mavatar'))
    await page.locator('.avatar-maker').waitFor({ state: 'detached' })
    await page.locator('.body-stage[data-avatar="mine"][data-state="ready"]').waitFor({ timeout: 30000 })
    await menu(page, '外观与能力')
    await page.getByRole('button', { name: '删掉我做的' }).click()
    await page.locator('.body-stage[data-avatar="hers"][data-state="ready"]').waitFor({ timeout: 30000 })
    assert.equal(await page.locator('.form-row').getByRole('button', { name: '我做的' }).count(), 0)
    await page.getByRole('button', { name: '关闭外观与能力' }).click()
    evidence.checks.push('Make your own: a .mavatar is taken as it is, a broken one is refused with a reason, and forgetting it goes back to her body')
  }

  // Pick the project folder: unknown folders wait for a trust decision before anything loads.
  await page.evaluate(path => window.anna.invoke({ type: 'workspace', path }), workspace)
  await page.locator('.trust-card').waitFor()
  assert.equal(await page.locator('.mode-switch button[data-mode="auto"]').isDisabled(), true)
  await page.screenshot({ path: 'artifacts/scripted-trust.png' })
  await page.getByRole('button', { name: '信任并开始', exact: true }).click()
  await until(page, s => s.state === 'ready' && s.workspace.trusted, 'trusted and connected')
  evidence.checks.push('Unknown folder asks for trust first; auto mode disabled until trusted')

  // The brain chip opens the unified card picker, with installed and missing agents.
  await page.locator('.brain-chip').click()
  await page.getByRole('button', { name: '选择其他大脑', exact: true }).click()
  await page.getByRole('radio', { name: /pi.*默认/ }).waitFor()
  assert(await page.locator('.brain-tile').count() > 15)
  assert.equal(await page.getByRole('radio', { name: /pi.*默认/ }).getAttribute('aria-checked'), 'true')
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()
  evidence.checks.push('Brain cards: pi is selected; catalogued agents remain visible even when unavailable')

  // Real Chromium decoding + app/Host wiring, with playback events and time controlled silently.
  assert.equal((await page.evaluate(baseURL => window.anna.voice({ type: 'voice-configure', config: { baseURL, model: 'fixture-tts', voice: 'fixture' }, key: '' }), `http://127.0.0.1:${voicePort}/v1`)).ok, true)
  await page.evaluate(() => {
    const state = { original: window.Audio, player: undefined }
    window.__annaAudioFixture = state
    window.Audio = class {
      currentTime = 0
      constructor() { state.player = this }
      async play() { this.onplaying?.() }
      pause() { this.onpause?.() }
      removeAttribute() {}
    }
  })
  await voiceControl(page, '开启模型语音')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送 ↗', exact: true }).click()
  await until(page, s => s.state === 'ready' && s.messages?.length === 2, 'greeting')
  await page.locator('.body-stage[data-speaking="true"]').waitFor()
  assert.equal(Number(await page.locator('.body-stage').getAttribute('data-voice-level')), 0)
  await page.evaluate(() => { window.__annaAudioFixture.player.currentTime = 0.3 })
  await page.waitForFunction(() => Number(document.querySelector('.body-stage').dataset.voiceLevel) > 0.3)
  await page.evaluate(() => { window.__annaAudioFixture.player.currentTime = 0.8 })
  await page.waitForFunction(() => Number(document.querySelector('.body-stage').dataset.voiceLevel) === 0)
  await page.getByRole('button', { name: '停止说话', exact: true }).click()
  await page.locator('.body-stage[data-speaking="false"][data-voice-level="0"]').waitFor()
  await page.evaluate(() => {
    window.__annaAudioFixture.player.onplaying?.()
    window.Audio = window.__annaAudioFixture.original
    delete window.__annaAudioFixture
  })
  assert.equal(await page.locator('.body-stage').getAttribute('data-speaking'), 'false')
  await voiceControl(page, '关闭模型语音')
  evidence.checks.push('Mouth: real offline decoding of synthetic WAV follows the controlled playback clock, silence closes it, stop ignores late events; audio playback is mocked and no speakers are used')

  // Switch to ask mode: Anna tilts her head (stricter) and greets the change.
  await page.locator('.mode-switch button[data-mode="ask"]').click()
  await page.locator('.model-canvas[data-mode="ask"][data-gesture="tilt"]').waitFor({ timeout: 3000 })
  await page.locator('.bubble').getByText('每次要动手之前我都会先问你').waitFor()
  assert.equal(await page.locator('.body-stage').getAttribute('data-speaking'), 'false')
  assert.equal(Number(await page.locator('.body-stage').getAttribute('data-voice-level')), 0)
  await page.screenshot({ path: 'artifacts/scripted-mode-ask.png' })
  evidence.checks.push('Mode change: stance + tilt gesture + greeting caption')

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
  if ((await snapshot(page)).platform.os === 'win32') {
    await page.getByRole('dialog', { name: '确认 Windows 放手模式' }).waitFor()
    assert.notEqual((await snapshot(page)).mode, 'auto')
    await page.screenshot({ path: 'artifacts/windows-auto-consent.png' })
    await page.getByRole('button', { name: '确认开启放手模式', exact: true }).click()
    await until(page, s => s.settings.windowsAutoAcknowledged && s.mode === 'auto', 'Windows bypass consent saved')
  }
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
  await menu(page, /外部 agent/)
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
  // Backups: Codex on DeepSeek falls back to Kimi; the queue shows on the card and in the status line.
  await page.locator('.app-tabs button[data-app="codex"]').click()
  for (const name of ['DeepSeek', 'Kimi']) {
    await page.getByRole('button', { name: '＋ 添加服务商', exact: true }).click()
    await page.getByRole('searchbox', { name: '搜索预设', exact: true }).fill(name.toLowerCase())
    await page.locator(`.preset-item[data-preset="${name}"]`).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await until(page, s => s.agents.mine.codex?.some(p => p.name === name), `${name} added`)
  }
  await page.locator('.provider-list li[data-provider="DeepSeek"]').getByRole('button', { name: /^让.+用它$/ }).click()
  await page.locator('.provider-list li[data-provider="Kimi"]').getByRole('button', { name: '设为备用', exact: true }).click()
  await until(page, s => s.agents.providers.codex?.provider === 'DeepSeek' && s.agents.providers.codex?.backups?.[0] === 'Kimi', 'Kimi is the backup')
  await page.locator('.provider-list li[data-provider="Kimi"] [data-backup="1"]').waitFor()
  assert.match(await page.locator('.status-line[data-app="codex"]').textContent(), /出错时换用：Kimi/)
  await page.screenshot({ path: 'artifacts/scripted-provider-backups.png' })
  await page.locator('.provider-list li[data-provider="Kimi"]').getByRole('button', { name: '移出备用', exact: true }).click()
  await until(page, s => !s.agents.providers.codex?.backups, 'backup removed')
  // Global routing: Codex in a terminal goes through Anna. In tests the configs live in the data folder, never in ~.
  const codexConfig = join(data, 'test-home/.codex/config.toml')
  await page.getByRole('checkbox', { name: '终端也走 Anna 的路由', exact: true }).check()
  await until(page, s => Boolean(s.agents.global.codex?.routing?.url), 'Codex routed globally')
  const takenOver = await readFile(codexConfig, 'utf8')
  assert.match(takenOver, /base_url = "http:\/\/127\.0\.0\.1:\d+\/codex\/v1"/)
  assert.match(takenOver, /experimental_bearer_token = "anna-route-/)
  await page.locator('.routing-global [data-routing="on"]').waitFor()
  // Aggregation: Kimi's models join the terminal Codex's model list under its key.
  await page.getByRole('checkbox', { name: '列进模型列表：Kimi', exact: true }).check()
  await until(page, s => s.agents.providers.codex?.aggregate?.[0] === 'Kimi', 'Kimi listed in the model list')
  await page.locator('.provider-list li[data-provider="Kimi"] [data-aggregated]').waitFor()
  const aggregated = JSON.parse(await readFile(join(data, 'test-home/.codex/anna-model-catalog.json'), 'utf8'))
  assert.ok(aggregated.models.some(entry => entry.slug.startsWith('anna-kimi/')), 'Kimi\'s models are in the catalog under anna-kimi/')
  evidence.checks.push('Aggregation: a provider ticked under global routing has its models in Codex\'s catalog as anna-kimi/<model>')
  await page.locator('.routing-policy summary').click()
  await page.screenshot({ path: 'artifacts/scripted-provider-routing.png' })
  await page.getByRole('checkbox', { name: '终端也走 Anna 的路由', exact: true }).uncheck()
  await until(page, s => !s.agents.global.codex?.routing, 'Codex routing off')
  assert.equal(existsSync(codexConfig), false)
  evidence.checks.push('Global routing for Codex: its config points at Anna while on, and is gone again when switched off (there was none before)')
  for (const name of ['Kimi', 'DeepSeek']) {
    await page.locator(`.provider-list li[data-provider="${name}"]`).getByRole('button', { name: '删除', exact: true }).click()
    await page.locator('.provider-list .approval-request').getByRole('button', { name: '删除', exact: true }).click()
    await until(page, s => !s.agents.mine.codex?.some(p => p.name === name), `${name} deleted`)
  }
  evidence.checks.push('A backup provider for Codex: set from its card, shown on the card and the status line, removed')
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

  // An ACP brain only runs inside her sandbox, so where there is none (Windows) it is not offered and not tested.
  if ((await snapshot(page)).platform.sandbox.available) {
    // An ACP agent as her brain (Gemini CLI, answered by the ACP fake): picked from the brain chip, its shell call
    // waits for her approval card, and its words come back as hers.
    await page.locator('.brain-chip').click()
    await page.getByRole('button', { name: '选择其他大脑', exact: true }).click()
    await page.getByRole('radio', { name: /Gemini CLI/ }).click()
    await page.getByRole('button', { name: '关闭设置', exact: true }).click()
    await until(page, s => s.state === 'ready' && s.settings.kernel === 'acp:gemini' && s.kernel.label === 'Gemini CLI', 'switched to the ACP brain')
    // Ask mode, so the agent's shell call has to come through her approval card.
    await page.locator('.mode-switch button[data-mode="ask"]').click()
    await until(page, s => s.mode === 'ask', 'ask mode')
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('touch 一个文件')
    await page.getByRole('button', { name: '发送 ↗', exact: true }).click()
    await until(page, s => s.approvals?.length > 0, 'the ACP shell call asks for approval')
    await page.getByRole('button', { name: '仅允许一次', exact: true }).click()
    const acp = await until(page, s => s.state === 'ready' && s.messages?.at(-1)?.text?.includes('ran for:'), 'ACP turn answered')
    assert.match(acp.messages.at(-1).text, /^ran for: .*touch 一个文件$/s)
    await page.screenshot({ path: 'artifacts/scripted-acp.png' })
    evidence.checks.push('ACP brain: picked from the brain chip, its shell call passed her approval card, its answer came back as hers')
  }
  else {
    evidence.checks.push('ACP brain: not run, no sandbox on this machine (an ACP brain only runs inside one)')
  }
  // Model speech is off again, and the chat box carries only the microphone.
  assert.equal(await page.locator('.composer').getByRole('button', { name: /模型语音|语音设置/ }).count(), 0)
  // A loopback fake validates the entire renderer → preload → Main → Core → audio response chain silently.
  await voiceControl(page, '语音设置')
  const voice = page.getByRole('dialog', { name: '语音对话', exact: true })
  assert.equal(await voice.getByRole('button', { name: '开启麦克风录音', exact: true }).isDisabled(), true)
  assert.equal(await page.locator('video, iframe').count(), 0)
  const recognition = voice.getByRole('group', { name: '语音识别', exact: true })
  const synthesis = voice.getByRole('group', { name: '语音合成', exact: true })
  // A fresh install has no local speech service, so an unsaved form starts on the cloud preset and only needs a key.
  // (Synthesis was already saved above for model speech, so it shows that saved local service instead.)
  assert.equal(await recognition.getByLabel('接入方式', { exact: true }).inputValue(), 'cloud')
  assert.equal(await recognition.getByLabel('服务地址', { exact: true }).inputValue(), 'https://token-plan-cn.xiaomimimo.com/v1')
  assert.equal(await recognition.getByLabel('接口格式', { exact: true }).inputValue(), 'chat')
  assert.equal(await synthesis.getByLabel('接入方式', { exact: true }).inputValue(), 'local')
  assert.equal(await synthesis.getByLabel('接口格式', { exact: true }).inputValue(), 'audio')
  await recognition.getByLabel('接入方式', { exact: true }).selectOption('local')
  await recognition.getByLabel('接口格式', { exact: true }).selectOption('chat')
  await recognition.getByLabel('服务地址', { exact: true }).fill(`http://127.0.0.1:${voicePort}/v1`)
  await recognition.getByLabel('模型 ID', { exact: true }).fill('fixture-asr')
  await recognition.getByLabel('API Key', { exact: true }).fill('fixture-asr-key')
  await recognition.getByRole('button', { name: '保存语音识别配置', exact: true }).click()
  await voice.getByRole('status').filter({ hasText: '语音识别配置已保存' }).waitFor()
  await synthesis.getByLabel('接入方式', { exact: true }).selectOption('local')
  await synthesis.getByLabel('服务地址', { exact: true }).fill(`http://127.0.0.1:${voicePort}/v1`)
  await synthesis.getByLabel('模型 ID', { exact: true }).fill('fixture-tts')
  await synthesis.getByLabel('音色 ID', { exact: true }).fill('fixture-voice')
  await synthesis.getByLabel('API Key', { exact: true }).fill('fixture-voice-key')
  await synthesis.getByRole('button', { name: '保存语音合成配置', exact: true }).click()
  await voice.getByRole('status').filter({ hasText: '语音合成配置已保存' }).waitFor()
  await voice.getByText('语音合成测试', { exact: true }).click()
  await synthesis.getByLabel('模型 ID', { exact: true }).fill('unsaved-tts')
  assert.equal(await voice.getByRole('button', { name: '生成语音文件', exact: true }).isDisabled(), true)
  await synthesis.getByLabel('模型 ID', { exact: true }).fill('fixture-tts')
  await synthesis.getByRole('button', { name: '保存语音合成配置', exact: true }).click()
  await voice.getByRole('status').filter({ hasText: '语音合成配置已保存' }).waitFor()
  await voice.getByRole('button', { name: '生成语音文件', exact: true }).click()
  const download = voice.getByRole('link', { name: '下载生成的语音', exact: true })
  await download.waitFor()
  const audio = await download.evaluate(async link => Array.from(new Uint8Array(await (await fetch(link.href)).arrayBuffer())))
  assert.equal(await page.locator('audio, video').count(), 0)
  await voice.getByLabel('音频文件', { exact: true }).setInputFiles({ name: 'synthetic.wav', mimeType: 'audio/wav', buffer: Buffer.from(audio) })
  await voice.getByRole('status').filter({ hasText: '识别完成，请核对文字' }).waitFor()
  assert.equal(await voice.getByRole('textbox', { name: '识别结果', exact: true }).inputValue(), '合成录音用于验证语音链路。')
  assert.equal(recognitionReads, 1)
  await voice.getByRole('button', { name: '将文字带到对话', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).inputValue(), '合成录音用于验证语音链路。')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('')
  await voiceControl(page, '语音设置')
  await voice.getByText('语音设置', { exact: true }).click()
  await synthesis.getByLabel('API Key', { exact: true }).getAttribute('placeholder').then(value => assert.match(value, /已保存/))
  assert.equal(await synthesis.getByLabel('API Key', { exact: true }).inputValue(), '')
  assert.equal(await recognition.getByLabel('API Key', { exact: true }).inputValue(), '')
  // Switching back to the cloud restores its preset, and changing endpoints never carries the local secret along.
  await recognition.getByLabel('接入方式', { exact: true }).selectOption('cloud')
  assert.equal(await recognition.getByLabel('服务地址', { exact: true }).inputValue(), 'https://token-plan-cn.xiaomimimo.com/v1')
  assert.equal(await recognition.getByLabel('接口格式', { exact: true }).inputValue(), 'chat')
  assert.equal(await recognition.getByLabel('API Key', { exact: true }).inputValue(), '')
  assert.equal(await recognition.getByLabel('替换密钥（输入框为空则清除）', { exact: true }).isChecked(), true)
  assert.equal(await voice.getByRole('button', { name: '开启麦克风录音', exact: true }).isDisabled(), true)
  await voice.getByRole('button', { name: '关闭', exact: true }).click()
  evidence.secretsMode = (await snapshot(page)).platform.secrets
  if (evidence.secretsMode === 'system') {
    const vault = await readFile(join(data, 'senses.bin'))
    assert.equal(vault.includes(Buffer.from('fixture-voice-key')), false)
    assert.equal(vault.includes(Buffer.from('fixture-asr-key')), false)
  }
  evidence.checks.push('Voice: direct local ASR (chat protocol) and TTS (audio protocol) via synthetic WAV and fake HTTP service, editable transcription reaches the unsent composer, saved keys remain masked, forms start on the cloud preset and switching never carries a secret along; no physical device, playback or real cloud call')
  if (packaged && process.platform === 'darwin')
    evidence.checks.push('Packaged macOS scripted credentials use isolated file fixtures; native Keychain authorization is not exercised')
  assert.deepEqual(evidence.consoleErrors, [])
}
catch (error) {
  const page = desktop.windows()[0]
  evidence.processErrors = processErrors
  if (page && !page.isClosed()) {
    evidence.failureText = await page.locator('body').textContent().catch(() => '')
    await page.screenshot({ path: 'artifacts/scripted-failure.png' }).catch(() => {})
  }
  throw error
}
finally {
  await desktop.close()
  await new Promise(resolve => voiceServer.close(resolve))
  await writeFile('artifacts/scripted-acceptance.json', JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
}
