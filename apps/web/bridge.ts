import type { AnnaBridge, AnnaEvent, Command, Reply } from '../../packages/shared/contracts'

/** Same contracts as Electron; a per-tab random capability replaces the desktop IPC boundary. */
export async function installWebBridge() {
  const listeners = new Set<(event: AnnaEvent) => void>()
  let token = sessionStorage.getItem('anna.web.session') ?? ''
  const headers = () => ({ 'Content-Type': 'application/json', 'X-Anna-Session': token })
  const check = await fetch('./api/session', { method: 'POST', headers: headers() })
  if (!check.ok)
    throw new Error('在线体验暂时满员，请稍后刷新。')
  token = (await check.json()).session
  sessionStorage.setItem('anna.web.session', token)

  const bridge: AnnaBridge = {
    async invoke(command: Command): Promise<Reply> {
      const response = await fetch('./api/command', { method: 'POST', headers: headers(), body: JSON.stringify(command) })
      return response.json()
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  window.anna = bridge

  async function stream() {
    try {
      const response = await fetch('./api/events', { headers: headers() })
      if (!response.ok || !response.body)
        throw new Error('会话连接中断，请刷新页面。')
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let pending = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done)
          break
        pending += value
        while (pending.includes('\n\n')) {
          const end = pending.indexOf('\n\n')
          const frame = pending.slice(0, end)
          pending = pending.slice(end + 2)
          if (frame.startsWith('data: ')) {
            const event = JSON.parse(frame.slice(6)) as AnnaEvent
            for (const listener of listeners) listener(event)
          }
        }
      }
    }
    catch { /* The next request or reconnect reports the actual runtime state. */ }
    window.setTimeout(() => { void stream() }, 2500)
  }
  void stream()
}
