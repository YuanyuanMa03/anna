/* eslint-disable antfu/no-top-level-await, no-console -- Desktop acceptance owns its processes. */
// Talking with her, end to end: a synthetic microphone stream (an oscillator standing in for the device) carries one
// utterance; Anna's own voice-activity detection cuts it, a loopback fake recognises it, the scripted brain answers, and
// the answer is synthesised aloud. Device capture itself is not covered: Electron's fake capture device never answers.
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { _electron } from 'playwright'
import { desktopLaunch } from './desktop-launch.mjs'

const data = await mkdtemp(resolve('.data/voice-talk-'))
const workspace = join(data, 'project')
await mkdir(workspace)
const script = join(data, 'script.json')
await writeFile(script, JSON.stringify([{ text: '我听到了，你好呀。' }]))
await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, onboardingComplete: true, kernel: 'pi', characterId: 'haru', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'scripted', baseURL: 'https://scripted.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'edit', rules: { allow: [], ask: [], deny: [] } } } }), { mode: 0o600 })

/** 16 kHz mono PCM16: one second of silence, a 1.2 s tone at speaking loudness, then eight seconds of silence. */
function utterance() {
  const rate = 16000
  const samples = rate * 10.2
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40)
  for (let i = rate; i < rate * 2.2; i++)
    wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 300 / rate) * 12000), 44 + i * 2)
  return wav
}
let recognitions = 0
let syntheses = 0
const server = createServer((req, res) => {
  const chunks = []
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => {
    if (req.url === '/v1/chat/completions') {
      recognitions++
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      assert.match(body.messages[0].content[0].input_audio.data, /^data:audio\/wav;base64,UklGR/)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '你好，Anna。' } }] }))
      return
    }
    if (req.url === '/v1/audio/speech') {
      syntheses++
      res.writeHead(200, { 'Content-Type': 'audio/wav' })
      res.end(utterance().subarray(0, 44 + 16000))
      return
    }
    res.writeHead(404)
    res.end()
  })
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${server.address().port}/v1`

const launch = desktopLaunch(data, { ANNA_TEST_SCRIPT: script, ANNA_TEST_KEY: 'scripted' })
const desktop = await _electron.launch(launch)
try {
  const page = await desktop.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.locator('.composer').waitFor()
  // Only Anna's own "allow the microphone?" dialog is answered; the rest of the chain runs as shipped.
  await desktop.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
  for (const request of [
    { type: 'recognition-configure', config: { mode: 'local', baseURL: base, protocol: 'chat', model: 'fixture-asr' }, key: 'fixture-key' },
    { type: 'voice-configure', config: { mode: 'local', baseURL: base, protocol: 'audio', model: 'fixture-tts', voice: 'fixture-voice' }, key: 'fixture-key' },
  ]) {
    const result = await page.evaluate(request => window.anna.voice(request), request)
    assert(result.ok, result.error)
  }
  // The microphone: silence, 1.2 s of a tone at speaking loudness, then silence.
  await page.evaluate(() => {
    window.microphones = []
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext()
      const tone = context.createOscillator()
      const gain = context.createGain()
      const output = context.createMediaStreamDestination()
      tone.frequency.value = 300
      tone.connect(gain).connect(output)
      const start = context.currentTime
      gain.gain.setValueAtTime(0, start)
      gain.gain.setValueAtTime(0.4, start + 1)
      gain.gain.setValueAtTime(0, start + 2.2)
      tone.start()
      window.microphones.push(output.stream)
      return output.stream
    }
  })
  // Capture the input's geometry through listening, recognition, execution and speech.
  await page.evaluate(() => {
    window.composerFrames = []
    window.measureComposer = true
    const sample = () => {
      if (!window.measureComposer)
        return
      const box = document.querySelector('.composer textarea').getBoundingClientRect()
      window.composerFrames.push({ y: box.y, height: box.height })
      requestAnimationFrame(sample)
    }
    sample()
  })
  const live = () => page.evaluate(() => window.microphones.flatMap(stream => stream.getTracks()).filter(track => track.readyState === 'live').length)
  // A double-click starts and then cancels: no microphone may be left open, and no talk shown.
  await page.getByRole('button', { name: '和她说话', exact: true }).dblclick()
  await page.getByRole('button', { name: '和她说话', exact: true }).waitFor()
  await page.waitForFunction(() => window.microphones.flatMap(stream => stream.getTracks()).every(track => track.readyState === 'ended'))
  assert.equal(await page.locator('.talk-state').count(), 0)
  await page.getByRole('button', { name: '和她说话', exact: true }).click()
  await page.getByRole('status').filter({ hasText: /^在听/ }).waitFor({ timeout: 15000 }).catch(async (error) => {
    console.error(`page says: ${((await page.locator('body').textContent()) ?? '').split('\n').filter(line => /麦克风|语音|对话|说话|在听/.test(line)).join(' / ')}`)
    throw error
  })
  for (let i = 0; ; i++) {
    const { snapshot } = await page.evaluate(() => window.anna.invoke({ type: 'snapshot' }))
    const said = snapshot.messages?.some(message => message.role === 'user' && message.text === '你好，Anna。')
    const answered = snapshot.messages?.some(message => message.role === 'assistant' && message.text.includes('我听到了'))
    if (said && answered && syntheses > 0)
      break
    assert(i < 150, `no spoken turn: ${recognitions} recognitions, ${syntheses} syntheses`)
    await new Promise(done => setTimeout(done, 200))
  }
  await page.screenshot({ path: 'artifacts/voice-talk.png' })
  await page.getByRole('button', { name: '结束对话', exact: true }).click()
  await page.getByRole('button', { name: '和她说话', exact: true }).waitFor()
  assert.equal(await page.locator('.talk-state').count(), 0)
  assert.equal(await live(), 0, 'the microphone is still open after the talk ended')
  const frames = await page.evaluate(() => {
    window.measureComposer = false
    return window.composerFrames
  })
  assert(frames.length > 10)
  assert(Math.max(...frames.map(frame => frame.y)) - Math.min(...frames.map(frame => frame.y)) < 1, 'the input jumped vertically during the conversation')
  assert(Math.max(...frames.map(frame => frame.height)) - Math.min(...frames.map(frame => frame.height)) < 1, 'the input changed height during the conversation')
  assert.equal(recognitions, 1)
  assert.deepEqual(errors, [])
  console.log('Voice talk: synthetic microphone stream → voice activity → recognition → scripted reply → synthesis, and the microphone closes when the talk ends.')
}
finally {
  await desktop.close()
  server.close()
  if (process.exitCode)
    console.error(`data kept at ${data}`)
}
