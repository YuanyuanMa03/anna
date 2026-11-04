/* eslint-disable no-console -- Optional, explicit real-service acceptance; never part of the automatic test suite. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { backend, page as backendPage, login } from '../packages/gateway/backend.mjs'

async function main() {
  if (process.env.ANNA_GATEWAY_REAL !== '1' || !process.env.ANNA_GATEWAY_CREDENTIALS)
    throw new Error('Explicit ANNA_GATEWAY_REAL=1 and ANNA_GATEWAY_CREDENTIALS are required; this creates/revokes a test device and makes two real speech calls.')
  const base = process.env.ANNA_GATEWAY_CONSOLE || 'http://127.0.0.1:17865'
  if (new URL(base).hostname !== '127.0.0.1')
    throw new Error('This acceptance is limited to a local workbench')
  const secrets = JSON.parse(await readFile(process.env.ANNA_GATEWAY_CREDENTIALS, 'utf8'))
  await mkdir('artifacts', { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } })
  const deviceName = `Anna-smoke-${Date.now()}`
  const failures = []
  page.on('pageerror', error => failures.push(error.message))
  await page.addInitScript(() => {
    window.__gatewayMedia = { play: 0, capture: 0 }
    HTMLMediaElement.prototype.play = function () { window.__gatewayMedia.play++; return Promise.reject(new Error('Acceptance forbids playback')) }
    navigator.mediaDevices.getUserMedia = async () => { window.__gatewayMedia.capture++; throw new Error('Acceptance forbids devices') }
  })
  const evidence = { checks: [], media: undefined, failures, screenshot: 'artifacts/gateway-overview.png' }
  try {
    await page.goto(base)
    await page.getByLabel('用户名', { exact: true }).fill(secrets.admin_username)
    await page.getByLabel('密码', { exact: true }).fill(secrets.admin_password)
    await page.getByRole('button', { name: '进入工作台 →', exact: true }).click()
    await page.getByRole('heading', { name: /把 Anna 的能力/ }).waitFor()
    evidence.checks.push('Real backend login and existing services/devices loaded without exposing credentials')
    await page.getByRole('button', { name: '连接一台设备', exact: true }).click()
    const dialog = page.locator('dialog')
    await dialog.getByLabel('设备名称', { exact: true }).fill(deviceName)
    await dialog.getByLabel('初始内部点数', { exact: true }).fill('100000')
    await dialog.getByRole('button', { name: '创建设备密钥', exact: true }).click()
    await dialog.getByRole('heading', { name: '设备已准备好，收好这把钥匙', exact: true }).waitFor()
    const key = (await dialog.locator('.key-box').textContent()).trim()
    assert.match(key, /^sk-/)
    await dialog.getByRole('button', { name: '带着它去试用 →', exact: true }).click()
    await page.getByRole('button', { name: '语音合成', exact: true }).click()
    await page.getByLabel('模型', { exact: true }).selectOption('kokoro-local')
    await page.getByLabel('让 Anna 说一句话', { exact: true }).fill('你好，我是安娜。')
    await page.getByRole('button', { name: '生成音频（静音）', exact: true }).click()
    await page.getByText('已生成', { exact: false }).waitFor({ timeout: 120000 })
    const pendingDownload = page.waitForEvent('download')
    await page.getByRole('link', { name: '下载音频，再用于语音识别测试 ↗', exact: true }).click()
    const download = await pendingDownload
    const audio = resolve('artifacts/gateway-voice.wav')
    await download.saveAs(audio)
    const wave = await readFile(audio)
    assert.equal(wave.toString('ascii', 0, 4), 'RIFF')
    assert.ok(wave.length > 1000)
    evidence.checks.push('Workbench creates a scoped device, sends real Kokoro TTS and downloads WAV without playback')
    await page.getByRole('button', { name: '语音识别', exact: true }).click()
    await page.getByLabel('模型', { exact: true }).selectOption('paraformer-zh-en')
    await page.getByLabel('音频文件', { exact: true }).setInputFiles(audio)
    await page.getByRole('button', { name: '开始识别', exact: true }).click()
    await page.locator('#test-result').filter({ hasText: '你好' }).waitFor({ timeout: 120000 })
    evidence.transcript = await page.locator('#test-result').textContent()
    evidence.audioBytes = wave.length
    evidence.checks.push('The generated WAV goes through workbench upload → gateway → New API → real Paraformer ASR')
    await page.getByRole('button', { name: '用量额度', exact: false }).click()
    await page.getByRole('heading', { name: '实际工作记录', exact: true }).waitFor()
    assert.ok((await page.locator('table').textContent()).includes('kokoro-local'))
    assert.ok((await page.locator('table').textContent()).includes('paraformer-zh-en'))
    await page.getByRole('button', { name: '设备密钥', exact: false }).click()
    const row = page.locator('tr').filter({ hasText: deviceName }).first()
    await row.getByRole('button', { name: '设置额度', exact: true }).click()
    await dialog.getByLabel('新的可用内部点数', { exact: true }).fill('90000')
    await dialog.getByRole('button', { name: '确认设置', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.match(await row.textContent(), /90,000/)
    await row.getByRole('button', { name: '撤销', exact: true }).click()
    await dialog.getByRole('button', { name: '确认撤销', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    const revoked = await fetch('http://127.0.0.1:17864/v1/models', { headers: { authorization: `Bearer ${key}` } })
    assert.ok([401, 403].includes(revoked.status), 'Revoked key must fail')
    evidence.checks.push('Quota replacement preserves scope; test key is revoked and rejected by the real data endpoint')
    await page.getByRole('button', { name: '总览', exact: false }).click()
    await page.getByRole('heading', { name: /把 Anna 的能力/ }).waitFor()
    await page.screenshot({ path: evidence.screenshot, fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile page must fit')
    await page.screenshot({ path: 'artifacts/gateway-mobile.png', fullPage: true })
    evidence.media = await page.evaluate(() => window.__gatewayMedia)
    assert.deepEqual(evidence.media, { play: 0, capture: 0 })
    assert.deepEqual(failures, [])
    await writeFile('artifacts/gateway-acceptance.json', JSON.stringify(evidence, null, 2))
    console.log(JSON.stringify(evidence))
  }
  finally {
    await browser.close()
    const config = { backendURL: 'http://127.0.0.1:17860' }
    const identity = await login(config, secrets.admin_username, secrets.admin_password)
    const found = backendPage(await backend(config, identity, `/api/token/search?keyword=${encodeURIComponent(`${deviceName}%`)}&p=1&page_size=100`)).items
    for (const item of found.filter(item => item.name.startsWith(`${deviceName} · `))) {
      await backend(config, identity, '/api/token/?status_only=true', { id: item.id, status: 2 }, 'PUT')
      await backend(config, identity, `/api/token/${item.id}`, undefined, 'DELETE')
    }
  }
}
void main()
