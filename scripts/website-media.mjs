// Captures the website's media from the real app with a scripted brain: no real model, no real keys.
// Produces artifacts/website-media/: frame captures of a work turn plus a hands-free voice talk (encoded to
// website/public/media/anna-live.mp4 with a poster), and stills of the newest panels (install guide, vendor
// tiles, the memory "us" tab, the voice talk states). ffmpeg must be on PATH for the encoding step.
//
// The scripted brain reads its responses once at startup and consumes them in order across turns, so the whole
// queue is written before launch: the work turn (read → write → reply), the voice turn's reply, and the memory
// proposal turn. Editing the script file after launch has no effect.
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile as write } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'
import { desktopLaunch } from '../tests/desktop-launch.mjs'

const root = resolve('.')
const framesDir = join(root, 'artifacts/website-media/frames')
const outDir = join(root, 'artifacts/website-media')
await mkdir(framesDir, { recursive: true })
const log = message => console.log(`[media] ${message}`)
let activePage
/** Screenshot with a readiness step; a failing still never aborts the rest of the capture. */
async function still(name, ready) {
  try {
    if (ready)
      await ready()
    await activePage.screenshot({ path: join(outDir, name) })
    log(`still ${name}`)
    return true
  }
  catch (error) {
    console.error(`[media] still ${name} failed: ${error.message}`)
    return false
  }
}

/** A speech-like WAV: bursts of a tone with pauses, so her mouth has something to follow. */
function speech(seconds, pitch) {
  const rate = 16000
  const samples = Math.floor(rate * seconds)
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) {
    // A syllable-ish envelope: ~180 ms voiced, ~90 ms pause, with a slower sentence rhythm on top.
    const open = Math.sin(i / rate * Math.PI * 2 * 3.4) > -0.55
    const envelope = open ? 0.55 + 0.15 * Math.sin(i / rate * Math.PI * 2 * 1.1) : 0.04
    wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * pitch / rate) * 11000 * envelope), 44 + i * 2)
  }
  return wav
}

const data = await mkdtemp(join(root, '.data/website-media-'))
const workspace = join(data, 'project')
await mkdir(workspace)
await write(join(workspace, 'tasks.txt'), ['买咖啡豆', '给 Anna 换一张新立绘', '整理本周笔记', '回邮件', ''].join('\n'))
const scriptFile = join(data, 'script.json')
const baseSettings = {
  version: 2,
  onboardingComplete: true,
  kernel: 'pi',
  characterId: 'haru',
  statusEnabled: false,
  memoryEnabled: true,
  model: { provider: 'custom', model: 'scripted', baseURL: 'https://scripted.invalid', api: 'openai-completions' },
  workspace,
  workspaces: { [workspace]: { trusted: true, mode: 'edit', rules: { allow: [], ask: [], deny: [] } } },
}
await write(join(data, 'settings.json'), JSON.stringify(baseSettings))
// The response queue, in the exact order the turns below consume it.
await write(scriptFile, JSON.stringify([
  { tools: [{ name: 'read', args: { path: 'tasks.txt' } }], wait: 700 },
  { tools: [{ name: 'write', args: { path: 'notes.md', content: '# 本周待办\n\n- 买咖啡豆\n- 给 Anna 换一张新立绘\n- 整理本周笔记\n- 回邮件\n' } }], wait: 800 },
  { text: '**整理好了**：待办都写进 notes.md 了，一共 4 条。' },
  { text: '**记下了**，我会提醒你的。还有别的要交给我吗？' },
  { tools: [{ name: 'anna_memory', args: { action: 'remember', text: '喜欢绿茶' } }] },
  { text: '我记下了你确认的偏好。' },
]))

const spoken = speech(4.6, 285)
let syntheses = 0
const server = createServer((req, res) => {
  const chunks = []
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => {
    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '今天记得提醒我买咖啡豆。' } }] }))
      return
    }
    if (req.url === '/v1/audio/speech') {
      syntheses++
      res.writeHead(200, { 'Content-Type': 'audio/wav' })
      res.end(spoken)
      return
    }
    res.writeHead(404)
    res.end()
  })
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${server.address().port}/v1`

const frames = []
let frameIndex = 0
async function capture(page, seconds, scene) {
  const start = frames.length
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    const at = Date.now()
    const name = `f${String(++frameIndex).padStart(4, '0')}.jpg`
    await page.screenshot({ path: join(framesDir, name), type: 'jpeg', quality: 85, scale: 'css' })
    frames.push({ name, at, scene })
  }
  log(`captured ${frames.length - start} frames for "${scene}"`)
}

const desktop = await _electron.launch(desktopLaunch(data, { ANNA_TEST_SCRIPT: scriptFile, ANNA_TEST_KEY: 'scripted' }))
try {
  const page = await desktop.firstWindow()
  activePage = page
  await page.setViewportSize({ width: 1280, height: 860 }).catch(() => {})
  page.on('pageerror', error => console.error(`[pageerror] ${error.message}`))
  await page.locator('.composer').waitFor({ timeout: 30000 })
  await page.locator('.model-canvas[data-state="ready"]').waitFor({ timeout: 30000 })
  // Only Anna's own "allow the microphone?" dialog is answered; the rest of the chain runs as shipped.
  await desktop.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
  for (const request of [
    { type: 'recognition-configure', config: { mode: 'local', baseURL: base, protocol: 'chat', model: 'fixture-asr' }, key: 'fixture-key' },
    { type: 'voice-configure', config: { mode: 'local', baseURL: base, protocol: 'audio', model: 'fixture-tts', voice: 'fixture-voice' }, key: 'fixture-key' },
  ]) {
    const result = await page.evaluate(request => window.anna.voice(request), request)
    assert(result.ok, result.error)
  }
  // The synthetic microphone: a pause to show the listening state, then a spoken burst, then silence.
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
      gain.gain.setValueAtTime(0.42, start + 3.4)
      gain.gain.setValueAtTime(0, start + 5.3)
      tone.start()
      window.microphones.push(output.stream)
      return output.stream
    }
  })
  const snapshot = async () => (await page.evaluate(() => window.anna.invoke({ type: 'snapshot' }))).snapshot
  /** Wait until the last message contains `part`; log the conversation state when it never arrives. */
  async function untilText(part, tries = 90) {
    for (let i = 0; ; i++) {
      const state = await snapshot()
      if (state.messages?.at(-1)?.text?.includes(part))
        return state
      if (i > tries) {
        log(`timeout waiting for "${part}"; state=${state.state} error=${state.error} last=${state.messages?.at(-1)?.role}:${state.messages?.at(-1)?.text?.slice(0, 40)}`)
        return state
      }
      await new Promise(done => setTimeout(done, 250))
    }
  }

  // Scene 1: her room, idling.
  await capture(page, 3.2, 'idle')
  // Scene 2: a work turn — read the todos, write the note, deliver.
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('把 tasks.txt 里的待办整理成 notes.md')
  await page.getByRole('button', { name: '发送 ↗', exact: true }).click()
  await capture(page, 11, 'work')
  await untilText('整理好了')
  await capture(page, 2, 'delivered')

  // Scene 3: hands-free voice — listening, then her spoken answer with moving lips.
  await page.getByRole('button', { name: '和她说话', exact: true }).click()
  await page.getByRole('status').filter({ hasText: /^在听/ }).waitFor({ timeout: 15000 })
  await still('voice-talk.raw.png')
  await capture(page, 6, 'listening')
  await untilText('记下了')
  assert(syntheses > 0, `no synthesis happened during the talk (${syntheses})`)
  await capture(page, 6.5, 'speaking')
  await still('voice-answer.raw.png')
  await page.getByRole('button', { name: '结束对话', exact: true }).click()
  await capture(page, 1.6, 'closing')

  // ── Stills of the newest panels ──
  // The memory flow: a proposal she confirms, then the "us" tab with their time together.
  try {
    const pending = page.evaluate(() => window.anna.invoke({ type: 'send', text: '聊聊我喜欢的茶' }))
    const candidate = page.locator('.approval-request')
    await candidate.getByLabel('准备记住的内容').fill('喜欢淡一点的绿茶')
    await candidate.getByRole('combobox', { name: '记忆分类', exact: true }).selectOption('preference')
    await still('memory-candidate.raw.png')
    await candidate.getByRole('button', { name: '确认记住', exact: true }).click()
    assert((await pending).ok)
    await untilText('我记下了')
    await page.locator('.brain-chip').click()
    const flow = page.getByRole('dialog', { name: 'Anna 档案', exact: true })
    await flow.getByRole('button', { name: '我们', exact: true }).click()
    await flow.getByRole('region', { name: '我们的关系' }).getByText('一起完成', { exact: true }).waitFor()
    await still('memory-together.raw.png')
    await page.getByRole('button', { name: '关闭设置', exact: true }).click()
    await page.getByRole('dialog', { name: 'Anna 档案', exact: true }).waitFor({ state: 'detached' })
  }
  catch (error) {
    console.error(`[media] memory stills failed: ${error.message}`)
  }

  // The install guide for a brain that is not on this machine yet, and the vendor tiles: both live in the
  // profile sheet's "choose a brain" and "connect a model" tabs.
  try {
    await page.locator('.brain-chip').click()
    const flow = page.getByRole('dialog', { name: 'Anna 档案', exact: true })
    await flow.getByRole('button', { name: '2 选择大脑', exact: true }).click()
    await flow.getByRole('button', { name: '选择其他大脑', exact: true }).click()
    await flow.getByRole('button', { name: '安装说明', exact: true }).first().click()
    const guide = flow.locator('.install-guide')
    await guide.getByText(/重新检测/).first().waitFor()
    await page.waitForFunction(() => { const box = document.querySelector('.install-guide')?.getBoundingClientRect(); return box && box.top >= 0 && box.top < window.innerHeight })
    await still('install-guide.raw.png')
    await guide.getByRole('button', { name: '收起', exact: true }).click()
    await flow.getByRole('button', { name: '3 接通模型', exact: true }).click()
    const group = flow.getByRole('radiogroup', { name: '模型厂商', exact: true })
    await group.waitFor()
    await group.getByRole('radio').nth(2).click()
    await page.waitForTimeout(400)
    await still('provider-tiles.raw.png')
    await page.getByRole('button', { name: '关闭设置', exact: true }).click()
  }
  catch (error) {
    console.error(`[media] install-guide/provider-tiles stills failed: ${error.message}`)
  }
}
finally {
  await desktop.close().catch(() => {})
}

server.close()

// ── Encoding: frames → one mp4, stills → webp, straight into the website ──
const mediaDir = join(root, 'website/public/media')
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')}\n${result.stderr || result.stdout}`)
}
const list = ['ffconcat version 1.0']
for (let i = 0; i < frames.length; i++)
  list.push(`file '${framesDir}/${frames[i].name}'`, `duration ${Math.max(0.04, ((frames[i + 1]?.at ?? frames[i].at + 120) - frames[i].at) / 1000)}`)
list.push(`file '${framesDir}/${frames[frames.length - 1].name}'`)
await write(join(outDir, 'frames.txt'), `${list.join('\n')}\n`)
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(outDir, 'frames.txt'), '-vf', 'fps=12,scale=1280:-2:flags=lanczos', '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'medium', '-movflags', '+faststart', join(mediaDir, 'anna-live.mp4')])
log('encoded anna-live.mp4')
// The poster is her mid-answer, from the speaking scene. cwebp: Homebrew's ffmpeg ships without libwebp.
const speaking = frames.filter(frame => frame.scene === 'speaking')
const poster = speaking[Math.floor(speaking.length / 2)] ?? frames[0]
run('cwebp', ['-quiet', '-q', '85', '-resize', '1280', '0', join(framesDir, poster.name), '-o', join(mediaDir, 'anna-live-poster.webp')])
for (const name of ['install-guide', 'provider-tiles', 'memory-together', 'voice-answer']) {
  run('cwebp', ['-quiet', '-q', '85', '-resize', '1600', '0', join(outDir, `${name}.raw.png`), '-o', join(mediaDir, `${name}.webp`)])
  log(`encoded ${name}.webp`)
}
await write(join(outDir, 'frames.json'), JSON.stringify(frames, null, 2))
log(`frames manifest: ${join(outDir, 'frames.json')}; raw frames kept in ${framesDir}`)
