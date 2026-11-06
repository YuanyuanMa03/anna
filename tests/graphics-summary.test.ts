import { describe, expect, it } from 'vitest'
import { graphicsSummary } from '../packages/shared/graphics'

describe('the graphics line in the log', () => {
  it('names WebGL status and the active GPU once the GPU process has reported', () => {
    const line = graphicsSummary({ webgl: 'enabled', webgl2: 'enabled' }, { gpuDevice: [{ vendorId: 0x8086, deviceId: 0x7D51, active: true }, { vendorId: 0x1414, deviceId: 0x8C, active: false }] })
    expect(line).toBe('graphics: webgl enabled, webgl2 enabled, gpu 8086:7d51 (Intel)')
  })

  it('says when no device is active, and copes with an empty or partial report', () => {
    expect(graphicsSummary({ webgl: 'enabled_readback', webgl2: 'unavailable_software' }, {})).toBe('graphics: webgl enabled_readback, webgl2 unavailable_software, gpu none reported')
    expect(graphicsSummary({}, undefined)).toBe('graphics: webgl unknown, gpu none reported')
    expect(graphicsSummary({ webgl: 'enabled' }, { gpuDevice: [{ vendorId: 0x106B, deviceId: 0, active: true }] })).toBe('graphics: webgl enabled, gpu 106b:0000 (Apple)')
  })
})
