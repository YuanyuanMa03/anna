/* eslint-disable antfu/no-top-level-await -- Opt-in acceptance with local model files and public test audio only. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { _electron } from 'playwright'
import { desktopLaunch } from './desktop-launch.mjs'

const modelDirectory = process.env.ANNA_HEARING_MODEL_DIR
const audio = process.env.ANNA_HEARING_AUDIO
const expected = process.env.ANNA_HEARING_EXPECT?.split('|').filter(Boolean)
assert(modelDirectory && audio && expected?.length, 'Set ANNA_HEARING_MODEL_DIR, ANNA_HEARING_AUDIO and ANNA_HEARING_EXPECT (expected phrases separated by |); use public/synthetic test audio: the report retains its transcript.')
const metadata = resolve(modelDirectory, 'preload.js.metadata')
const model = resolve(modelDirectory, 'preload.data')
async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
await mkdir('.data', { recursive: true })
await mkdir('artifacts', { recursive: true })
const data = await mkdtemp(resolve('.data/local-hearing-'))
const script = join(data, 'script.json')
await writeFile(script, '[]')
await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, onboardingComplete: true, kernel: 'pi', characterId: 'haru', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'scripted', baseURL: 'https://scripted.invalid', api: 'openai-completions' }, workspaces: {} }))
const evidence = { modelSha256: await sha256(model), audioSha256: await sha256(audio), expected, transcript: '', rendererOffline: false, deviceCalls: [], playbackCalls: 0, loadMs: 0, recognitionMs: 0, checks: [] }
const desktop = await _electron.launch(desktopLaunch(data, { ANNA_TEST_SCRIPT: script, ANNA_TEST_KEY: 'scripted' }))
try {
  const page = await desktop.firstWindow()
  await page.locator('.scene').waitFor()
  await page.context().setOffline(true)
  evidence.rendererOffline = true
  await page.evaluate(() => {
    window.__hearingAcceptance = { deviceCalls: [], playbackCalls: 0 }
    navigator.mediaDevices.getUserMedia = async () => { window.__hearingAcceptance.deviceCalls.push('user-media'); throw new Error('Real devices are forbidden in acceptance') }
    navigator.mediaDevices.getDisplayMedia = async () => { window.__hearingAcceptance.deviceCalls.push('display-media'); throw new Error('Real devices are forbidden in acceptance') }
    HTMLMediaElement.prototype.play = async () => { window.__hearingAcceptance.playbackCalls++; throw new Error('Playback is forbidden in acceptance') }
  })
  await page.getByRole('button', { name: '感官', exact: true }).click()
  const senses = page.getByRole('dialog', { name: 'Anna 感官', exact: true })
  await desktop.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }) }, [metadata, model])
  await senses.getByRole('button', { name: '导入并保存本地模型包', exact: true }).click()
  await senses.getByRole('status').filter({ hasText: '模型已保存在本机' }).waitFor({ timeout: 30000 })
  let start = Date.now()
  await senses.getByRole('button', { name: '加载已保存的本地模型', exact: true }).click()
  await senses.getByRole('status').filter({ hasText: '本地模型已就绪' }).waitFor({ timeout: 125000 })
  evidence.loadMs = Date.now() - start
  start = Date.now()
  await senses.getByLabel('预录音频', { exact: true }).setInputFiles(resolve(audio))
  await senses.getByRole('status').filter({ hasText: '识别完成，请核对文字' }).waitFor({ timeout: 125000 })
  evidence.recognitionMs = Date.now() - start
  evidence.transcript = await senses.getByRole('textbox', { name: '识别结果', exact: true }).inputValue()
  Object.assign(evidence, await page.evaluate(() => window.__hearingAcceptance))
  const normalize = value => value.toLowerCase().replace(/[\p{P}\s]/gu, '')
  for (const phrase of expected) assert(normalize(evidence.transcript).includes(normalize(phrase)), `Missing expected phrase: ${phrase}; actual: ${evidence.transcript}`)
  evidence.checks.push('Real local model and prerecorded audio match the supplied reference phrases with renderer networking disabled')
  await senses.getByRole('button', { name: '将文字带到对话', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).inputValue(), evidence.transcript)
  const snapshot = await page.evaluate(() => window.anna.invoke({ type: 'snapshot' }))
  assert(snapshot.ok)
  assert.equal(snapshot.snapshot.messages.length, 0)
  Object.assign(evidence, await page.evaluate(() => window.__hearingAcceptance))
  assert.deepEqual(evidence.deviceCalls, [])
  assert.equal(evidence.playbackCalls, 0)
  evidence.checks.push('Transcript enters the unsent composer; no physical device, playback or model task is started')
}
finally {
  await desktop.close()
  await writeFile('artifacts/local-hearing-acceptance.json', JSON.stringify(evidence, null, 2))
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
}
