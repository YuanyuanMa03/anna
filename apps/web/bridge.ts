import type { AnnaBridge, AnnaEvent, Command, Reply } from '../../packages/shared/contracts'
import { shortPaths } from '../desktop/src/online'

/** Same contracts as Electron; a per-tab random capability replaces the desktop IPC boundary. */
export async function installWebBridge() {
  const listeners = new Set<(event: AnnaEvent) => void>()
  let token = sessionStorage.getItem('anna.web.session') ?? ''
  const headers = () => ({ 'Content-Type': 'application/json', 'X-Anna-Session': token })
  const check = await fetch('./api/session', { method: 'POST', headers: headers() })
  if (!check.ok)
    throw new Error((await check.json().catch(() => ({}))).error ?? '在线体验暂时无法连接，请稍后刷新。')
  token = (await check.json()).session
  sessionStorage.setItem('anna.web.session', token)

  // The visitor's workspace, learned from the first snapshot: shown as `workspace` rather than the server's path.
  let root = ''
  const learn = (value: { snapshot?: { workspace?: { path?: string } } }) => { root ||= value.snapshot?.workspace?.path ?? '' }
  const bridge: AnnaBridge = {
    async invoke(command: Command): Promise<Reply> {
      const response = await fetch('./api/command', { method: 'POST', headers: headers(), body: JSON.stringify(command) })
      const reply = await response.json() as Reply
      learn(reply as never)
      return shortPaths(reply, root)
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  window.anna = bridge

  async function stream() {
    try {
      const response = await fetch('./api/events', { headers: headers() })
      // The session ended (idle cleanup or a restart): start a fresh one rather than retrying forever.
      if (response.status === 401) {
        sessionStorage.removeItem('anna.web.session')
        location.reload()
        return
      }
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
            learn(event as never)
            for (const listener of listeners) listener(shortPaths(event, root))
          }
        }
      }
    }
    catch { /* The next request or reconnect reports the actual runtime state. */ }
    window.setTimeout(() => { void stream() }, 2500)
  }
  void stream()
}
