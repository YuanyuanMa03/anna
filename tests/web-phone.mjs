/* eslint-disable antfu/no-top-level-await, no-console -- Acceptance script owns its server and browser. */
// The online demo on a phone: nothing the visitor reads may sit on top of her stage.
//   pnpm build:web && node tests/web-phone.mjs
// Starts the built web server with a fake model key (no model call is made) and opens it at phone sizes.
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const port = 7960 + Math.floor(Math.random() * 30)
const data = await mkdtemp(join(tmpdir(), 'anna-web-phone-'))
const server = spawn(process.execPath, ['dist/web-server.js'], { env: { ...process.env, PORT: String(port), ANNA_RELAY_PORT: String(port + 100), ANNA_MODEL_API_KEY: 'fake-local', ANNA_WEB_DATA: data }, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`web server did not start:\n${log}`)), 20_000)
  const read = (chunk) => {
    log += chunk
    if (log.includes('listening')) {
      clearTimeout(timer)
      resolve()
    }
  }
  server.stdout.on('data', read)
  server.stderr.on('data', read)
  server.on('exit', (code) => {
    clearTimeout(timer)
    reject(new Error(`web server exited ${code}:\n${log}`))
  })
})

let browser
const failures = []
try {
  await ready
  // Installed Google Chrome by default; ANNA_PHONE_BROWSER=chromium uses Playwright's own (`npx playwright install chromium`).
  browser = await chromium.launch(process.env.ANNA_PHONE_BROWSER === 'chromium' ? {} : { channel: 'chrome' })
  for (const [width, height] of [[375, 812], [390, 844], [360, 740]]) {
    const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true })
    await page.goto(`http://127.0.0.1:${port}/`)
    await page.locator('.tour-card').waitFor({ timeout: 20_000 })
    await page.locator('.speech .bubble').first().waitFor()
    const layout = await page.evaluate(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right } }
      const stage = box(document.querySelector('.stage'))
      const readable = [...document.querySelectorAll('.speech .bubble, .speech .suggestions button, .props > *')].map(el => ({ name: el.className || el.tagName, ...box(el) }))
      return { stage, readable, pageWidth: document.documentElement.scrollWidth }
    })
    const overlaps = (a, b) => a.top < b.bottom - 1 && b.top < a.bottom - 1 && a.left < b.right - 1 && b.left < a.right - 1
    for (const item of layout.readable) {
      if (overlaps(item, layout.stage))
        failures.push(`${width}x${height}: "${item.name}" (${Math.round(item.top)}–${Math.round(item.bottom)}) covers the stage (${Math.round(layout.stage.top)}–${Math.round(layout.stage.bottom)})`)
      if (item.right > width + 1 || item.left < -1)
        failures.push(`${width}x${height}: "${item.name}" runs off the screen (${Math.round(item.left)}–${Math.round(item.right)})`)
    }
    if (layout.stage.bottom - layout.stage.top < 280)
      failures.push(`${width}x${height}: the stage is only ${Math.round(layout.stage.bottom - layout.stage.top)}px tall`)
    if (layout.pageWidth > width + 1)
      failures.push(`${width}x${height}: the page scrolls sideways (${layout.pageWidth}px)`)
    await page.close()
  }
}
finally {
  await browser?.close()
  server.kill()
  await rm(data, { recursive: true, force: true })
}
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('web phone layout: ok')
