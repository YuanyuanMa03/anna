/** Vendors worth naming in a log line; the ID alone is enough for everything else. */
const vendors: Record<number, string> = { 0x8086: 'Intel', 0x10DE: 'NVIDIA', 0x1002: 'AMD', 0x106B: 'Apple', 0x1414: 'Microsoft' }
const hex = (value: number) => value.toString(16).padStart(4, '0')

/**
 * One log line on graphics, for a support log. Written once the GPU process has reported: read at startup, the feature
 * status is still a placeholder (Windows showed `webgl disabled_off` while WebGL rendered fine).
 */
export function graphicsSummary(status: { webgl?: string, webgl2?: string }, info: { gpuDevice?: { vendorId: number, deviceId: number, active?: boolean }[] } | undefined): string {
  const device = info?.gpuDevice?.find(item => item.active)
  const gpu = device ? `${hex(device.vendorId)}:${hex(device.deviceId)}${vendors[device.vendorId] ? ` (${vendors[device.vendorId]})` : ''}` : 'none reported'
  // Electron 44 returned no `webgl2` entry on macOS and Windows, so only what it does report is written.
  const features = (['webgl', 'webgl2'] as const).filter(name => status[name] !== undefined).map(name => `${name} ${status[name]}`)
  return `graphics: ${[...(features.length ? features : ['webgl unknown']), `gpu ${gpu}`].join(', ')}`
}
