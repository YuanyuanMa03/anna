/* eslint-disable antfu/no-top-level-await, no-console -- Acceptance script owns its server and browser. */
// The online demo on a phone: nothing the visitor reads may sit on top of her stage, fade out of reach, or leave the screen.
//   pnpm build:web && pnpm test:web-phone
// Starts the built web server with a fake model key (no message is sent) and opens it at phone sizes.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const entry = resolve('dist/web-server.js')
if (!existsSync(entry))
  throw new Error('dist/web-server.js is missing; run pnpm build:web first.')

function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer().once('error', fail).listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => done(port))
    })
  })
}
const [port, relayPort] = [await freePort(), await freePort()]
const data = await mkdtemp(join(tmpdir(), 'anna-web-phone-'))
const server = spawn(process.execPath, [entry], { env: { ...process.env, PORT: String(port), ANNA_RELAY_PORT: String(relayPort), ANNA_MODEL_API_KEY: 'fake-local', ANNA_WEB_DATA: data }, stdio: ['ignore', 'pipe', 'pipe'] })
const exited = new Promise(done => server.once('exit', done))
let log = ''
const ready = new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error(`web server did not start:\n${log}`)), 20_000)
  const read = (chunk) => {
    log += chunk
    if (log.includes('listening')) {
      clearTimeout(timer)
      done()
    }
  }
  server.stdout.on('data', read)
  server.stderr.on('data', read)
  server.once('error', (error) => {
    clearTimeout(timer)
    fail(error)
  })
  server.once('exit', (code) => {
    clearTimeout(timer)
    fail(new Error(`web server exited ${code}:\n${log}`))
  })
})

// Playwright's own Chromium (`npx playwright install chromium`); installed Google Chrome when that is missing.
async function launch() {
  try { return await chromium.launch() }
  catch { return await chromium.launch({ channel: 'chrome' }) }
}

// States a visitor can reach later, applied straight to the page: the first meeting, the body form, a reply that faded.
const states = {
  'first screen': () => {},
  'onboarding': () => document.querySelector('.app-shell').classList.add('life-onboarding'),
  'body form': () => document.querySelector('.scene').setAttribute('data-form', 'body'),
  'faded reply': () => document.querySelector('.speech').classList.add('quiet'),
}

let browser
const failures = []
try {
  await ready
  browser = await launch()
  for (const [width, height] of [[375, 812], [390, 844], [360, 740]]) {
    const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true })
    await page.goto(`http://127.0.0.1:${port}/`)
    await page.locator('.tour-card').waitFor({ timeout: 20_000 })
    await page.locator('.speech .bubble').first().waitFor()
    for (const [state, apply] of Object.entries(states)) {
      const layout = await page.evaluate(`(${apply})(), (() => {
        const box = el => { const r = el.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right } }
        const readable = [...document.querySelectorAll('.speech .bubble, .speech .suggestions button, .props > *')].map(el => ({ name: el.className || el.tagName, ...box(el) }))
        return { stage: box(document.querySelector('.stage')), readable, speechOpacity: Number(getComputedStyle(document.querySelector('.speech')).opacity), pageWidth: document.documentElement.scrollWidth }
      })()`)
      const where = `${width}x${height} ${state}`
      const overlaps = (a, b) => a.top < b.bottom - 1 && b.top < a.bottom - 1 && a.left < b.right - 1 && b.left < a.right - 1
      for (const item of layout.readable) {
        if (overlaps(item, layout.stage))
          failures.push(`${where}: "${item.name}" (${Math.round(item.top)}–${Math.round(item.bottom)}) covers the stage (${Math.round(layout.stage.top)}–${Math.round(layout.stage.bottom)})`)
        if (item.right > width + 1 || item.left < -1)
          failures.push(`${where}: "${item.name}" runs off the screen (${Math.round(item.left)}–${Math.round(item.right)})`)
      }
      if (layout.stage.left < -1 || layout.stage.right > width + 1)
        failures.push(`${where}: the stage runs off the screen (${Math.round(layout.stage.left)}–${Math.round(layout.stage.right)})`)
      if (layout.stage.bottom - layout.stage.top < 280)
        failures.push(`${where}: the stage is only ${Math.round(layout.stage.bottom - layout.stage.top)}px tall`)
      if (layout.speechOpacity < 0.9)
        failures.push(`${where}: her words fade to ${layout.speechOpacity} and a phone has no hover to bring them back`)
      if (layout.pageWidth > width + 1)
        failures.push(`${where}: the page scrolls sideways (${layout.pageWidth}px)`)
    }
    await page.close()
  }
}
finally {
  await browser?.close()
  server.kill()
  await Promise.race([exited, new Promise(done => setTimeout(done, 5_000))])
  await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('web phone layout: ok')
