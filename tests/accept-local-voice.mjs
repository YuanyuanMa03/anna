/* eslint-disable antfu/no-top-level-await -- Explicit local-only model acceptance; never captures or plays audio. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
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

assert.equal(process.env.ANNA_LOCAL_VOICE_ACCEPT, '1', 'Opt in with ANNA_LOCAL_VOICE_ACCEPT=1')
const url = new URL(process.env.ANNA_LOCAL_VOICE_URL ?? 'http://127.0.0.1:17861/v1')
assert(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash, 'Acceptance only uses an uncredentialed loopback HTTP endpoint')
const baseURL = url.href.replace(/\/+$/, '')
await mkdir('.data', { recursive: true })
await mkdir('artifacts', { recursive: true })
const data = await mkdtemp(resolve('.data/local-voice-'))
const script = join(data, 'script.json')
await writeFile(script, '[]')
await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, onboardingComplete: true, kernel: 'pi', characterId: 'haru', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'scripted', baseURL: 'https://scripted.invalid', api: 'openai-completions' }, workspaces: {} }))
const evidence = { input: '你好，我是安娜。我们可以一起工作，也可以聊聊天。', transcript: '', deviceCalls: 0, playbackCalls: 0, checks: [] }
const desktop = await _electron.launch(desktopLaunch(data, { ANNA_TEST_SCRIPT: script, ANNA_TEST_KEY: 'scripted', ANNA_TEST_FAKE_AGENT: resolve('tests/fixtures/fake-agent.mjs'), ANNA_TEST_NODE: process.execPath }))
try {
  const page = await desktop.firstWindow()
  await page.addInitScript(() => {
    window.__voiceAcceptance = { deviceCalls: 0, playbackCalls: 0 }
    navigator.mediaDevices.getUserMedia = async () => { window.__voiceAcceptance.deviceCalls++; throw new Error('Real devices are forbidden') }
    HTMLMediaElement.prototype.play = async () => { window.__voiceAcceptance.playbackCalls++; throw new Error('Playback is forbidden') }
  })
  await page.reload()
  await page.locator('.scene').waitFor()
  await voiceControl(page, '语音设置')
  const voice = page.getByRole('dialog', { name: '语音对话', exact: true })
  for (const [label, model] of [['语音识别', 'paraformer-local'], ['语音合成', 'kokoro-local']]) {
    const group = voice.getByRole('group', { name: label, exact: true })
    await group.getByLabel('服务地址', { exact: true }).fill(baseURL)
    await group.getByLabel('模型 ID', { exact: true }).fill(model)
    if (label === '语音合成')
      await group.getByLabel('音色 ID', { exact: true }).fill('anna')
    await group.getByRole('button', { name: `保存${label}配置`, exact: true }).click()
    await voice.getByRole('status').filter({ hasText: `${label}配置已保存` }).waitFor()
  }
  await voice.getByText('语音合成测试', { exact: true }).click()
  await voice.getByRole('textbox', { name: '语音测试文本', exact: true }).fill(evidence.input)
  await voice.getByRole('button', { name: '生成语音文件', exact: true }).click()
  const download = voice.getByRole('link', { name: '下载生成的语音', exact: true })
  await download.waitFor({ timeout: 95000 })
  const bytes = await download.evaluate(async link => Array.from(new Uint8Array(await (await fetch(link.href)).arrayBuffer())))
  await voice.getByLabel('音频文件', { exact: true }).setInputFiles({ name: 'synthetic-speech.wav', mimeType: 'audio/wav', buffer: Buffer.from(bytes) })
  await voice.getByRole('status').filter({ hasText: '识别完成，请核对文字' }).waitFor({ timeout: 95000 })
  evidence.transcript = await voice.getByRole('textbox', { name: '识别结果', exact: true }).inputValue()
  assert.match(evidence.transcript, /你好/)
  assert.match(evidence.transcript, /一起工作|聊聊天/)
  Object.assign(evidence, await page.evaluate(() => window.__voiceAcceptance))
  assert.equal(evidence.deviceCalls, 0)
  assert.equal(evidence.playbackCalls, 0)
  evidence.checks.push('Desktop UI → Host → local neural TTS → WAV conversion → Host → local neural ASR; synthesized reference text only; no real microphone, speakers or cloud inference')
}
finally {
  await desktop.close()
  await writeFile('artifacts/local-voice-acceptance.json', JSON.stringify(evidence, null, 2))
}
