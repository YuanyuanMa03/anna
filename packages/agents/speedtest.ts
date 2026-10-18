/** One endpoint's result: round-trip time of a GET after a warm-up request, or why it failed. */
export interface EndpointLatency { url: string, latency?: number, status?: number, error?: string }

/**
 * Time each endpoint the way cc-switch does: one warm-up GET (DNS, TLS), then a timed GET, all in parallel, each with
 * its own timeout. Any HTTP status counts as reachable: a 401 or 404 from an API root still measures the network.
 */
export async function testEndpoints(urls: string[], options: { timeoutMs?: number, fetch?: typeof fetch } = {}): Promise<EndpointLatency[]> {
  const timeout = Math.min(Math.max(options.timeoutMs ?? 8000, 2000), 30000)
  const get = options.fetch ?? fetch
  const once = async (url: string) => {
    const response = await get(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeout) })
    await response.body?.cancel().catch(() => {})
    return response.status
  }
  return Promise.all(urls.map(async (url): Promise<EndpointLatency> => {
    if (!URL.canParse(url))
      return { url, error: '地址无效' }
    await once(url).catch(() => {})
    const start = performance.now()
    try {
      const status = await once(url)
      return { url, latency: Math.round(performance.now() - start), status }
    }
    catch (error) {
      const name = (error as Error).name
      return { url, error: name === 'TimeoutError' || name === 'AbortError' ? '请求超时' : '连接失败' }
    }
  }))
}
