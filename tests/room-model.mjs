/* eslint-disable antfu/no-top-level-await, no-console -- Executable asset acceptance, no provider requests. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from 'playwright'

// This checks the actual exported binary with Anna's actual Cubism Core. A .model3.json alone
// or a shader/image animation cannot pass it. No agent reply or model API is simulated here.
await mkdir('artifacts/live2d-authoring', { recursive: true })
const path = 'assets/anna-room/anna.moc3'
const bytes = await readFile(path)
const browser = await chromium.launch({ channel: process.env.ANNA_CHROME_CHANNEL ?? 'chrome', headless: true })
try {
  const page = await browser.newPage()
  await page.addScriptTag({ path: 'assets/live2dcubismcore.min.js' })
  const evidence = await page.evaluate((input) => {
    const core = window.Live2DCubismCore
    const moc = core.Moc.fromArrayBuffer(new Uint8Array(input).buffer)
    if (!moc)
      throw new Error('Cubism rejected anna.moc3')
    const model = core.Model.fromMoc(moc)
    if (!model)
      throw new Error('Cubism could not create Anna')
    const snapshot = () => {
      model.update()
      const positions = model.drawables.vertexPositions.flatMap(points => [...points])
      if (!positions.every(Number.isFinite))
        throw new Error('Non-finite geometry')
      return { positions, opacity: [...model.drawables.opacities] }
    }
    model.parameters.values.set(model.parameters.defaultValues)
    const baseline = snapshot()
    const checks = []
    for (const [id, value] of [['ParamEyeLOpen', 0], ['ParamEyeROpen', 0], ['ParamMouthOpenY', 1], ['ParamAngleX', 20], ['ParamAngleY', 20], ['ParamAngleZ', 20], ['ParamBreath', 1], ['ParamBodyAngleX', 8], ['ParamHairFront', 1], ['ParamEyeBallX', 1], ['ParamEyeBallY', 1], ['ParamBrowLY', 1], ['ParamBrowRY', 1], ['ParamMouthForm', 1]]) {
      model.parameters.values.set(model.parameters.defaultValues)
      const index = model.parameters.ids.indexOf(id)
      if (index < 0)
        throw new Error(`Missing ${id}`)
      model.parameters.values[index] = value
      const result = snapshot()
      checks.push({
        id,
        value,
        geometryChange: Math.max(...result.positions.map((n, i) => Math.abs(n - baseline.positions[i]))),
        opacityChange: Math.max(...result.opacity.map((n, i) => Math.abs(n - baseline.opacity[i]))),
      })
    }
    const result = { parameters: [...model.parameters.ids], drawables: model.drawables.count, canvas: [model.canvasinfo.CanvasWidth, model.canvasinfo.CanvasHeight], checks }
    model.release()
    moc._release()
    return result
  }, [...bytes])
  assert.deepEqual(evidence.canvas, [1664, 941])
  assert.equal(evidence.drawables, 4)
  for (const check of evidence.checks)
    assert(check.geometryChange > 0 || check.opacityChange > 0, `${check.id} has no rendered effect`)
  await writeFile('artifacts/live2d-authoring/core-checks.json', `${JSON.stringify({ binary: path, sha256: createHash('sha256').update(bytes).digest('hex'), ...evidence }, null, 2)}\n`)
  console.log(`Cubism binary accepted: ${evidence.parameters.length} parameters, ${evidence.drawables} meshes; ${evidence.checks.length} controls change actual geometry or opacity.`)
}
finally { await browser.close() }
