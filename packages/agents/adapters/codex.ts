import type { Decoded, Decoder } from './types'
import { nothing } from './types'

/** Codex runs commands as `/bin/zsh -lc '<cmd>'` (or bash/sh); recover `<cmd>` so Anna's command policy sees it. */
export function unwrapShell(command: string) {
  const match = /^(?:\S*\/)?(?:zsh|bash|sh)\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(command.trim())
  if (!match)
    return command
  const body = match[2]!
  return match[1] === '\'' ? body.replace(/'\\''/g, '\'') : body.replace(/\\(["\\$`])/g, '$1')
}

interface Item { type: string, id: string, command?: string, cwd?: string, status?: string, text?: string, aggregatedOutput?: string | null, changes?: { path: string, kind?: unknown }[] }

function toolOf(item: Item): { name: string, input: Record<string, unknown> } | undefined {
  if (item.type === 'commandExecution')
    return { name: 'bash', input: { command: unwrapShell(item.command ?? ''), cwd: item.cwd } }
  if (item.type === 'fileChange') {
    const first = item.changes?.[0]
    const added = JSON.stringify(first?.kind ?? '').includes('add')
    return { name: added ? 'write' : 'edit', input: { path: first?.path, paths: item.changes?.map(change => change.path) } }
  }
  if (item.type === 'mcpToolCall' || item.type === 'webSearch')
    return { name: `codex:${item.type}`, input: { ...item } }
}

/**
 * `codex app-server`: JSON-RPC over stdio. Items (commandExecution, fileChange, agentMessage) start and complete;
 * approvals arrive as server requests (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`)
 * whose ids live in the server's own id space.
 */
export function codexDecoder(): Decoder {
  const items = new Map<string, Item>()
  let text = ''
  let delta = ''
  return {
    decode(line: string): Decoded {
      let message: any
      try { message = JSON.parse(line) }
      catch { return nothing() }
      const out: Decoded = { events: [] }
      const params = message.params ?? {}
      if (message.result?.thread?.id)
        out.sessionId = message.result.thread.id
      switch (message.method) {
        case 'item/started': {
          const item = params.item as Item
          items.set(item.id, item)
          const tool = toolOf(item)
          if (tool)
            out.events.push({ type: 'tool-start', id: item.id, name: tool.name, input: tool.input })
          if (item.type === 'agentMessage')
            delta = ''
          break
        }
        case 'item/agentMessage/delta':
          delta += params.delta ?? ''
          out.events.push({ type: 'text', text: delta })
          break
        case 'item/reasoning/textDelta':
        case 'item/reasoning/summaryTextDelta':
          out.events.push({ type: 'thinking' })
          break
        case 'item/completed': {
          const item = params.item as Item
          if (item.type === 'agentMessage' && item.text) {
            text = item.text
            out.events.push({ type: 'text', text })
          }
          else if (toolOf(item)) {
            const failed = item.status !== 'completed'
            out.events.push({ type: 'tool-end', id: item.id, name: toolOf(item)!.name, output: item.aggregatedOutput ?? (failed ? `${item.status}` : ''), isError: failed })
          }
          break
        }
        case 'item/commandExecution/requestApproval':
        case 'item/fileChange/requestApproval': {
          const item = items.get(params.itemId)
          const tool = item ? toolOf(item) : undefined
          const fallback = message.method.includes('command') ? { name: 'bash', input: { command: unwrapShell(params.command ?? ''), cwd: params.cwd } } : { name: 'edit', input: { path: params.grantRoot } }
          const chosen = params.command ? { name: 'bash', input: { command: unwrapShell(params.command), cwd: params.cwd } } : tool ?? fallback
          out.approval = { id: message.id, tool: chosen.name, input: chosen.input, raw: params }
          break
        }
        case 'thread/compacted':
          out.events.push({ type: 'compacting', active: false })
          break
        case 'turn/completed':
          out.done = { text, isError: params.turn?.status === 'failed' }
          break
        case 'error':
          if (params.willRetry)
            out.events.push({ type: 'retrying', attempt: 1 })
          break
      }
      return out
    },
    answer(approval, decision) {
      return JSON.stringify({ id: approval.id, result: { decision: decision.allow ? 'accept' : 'decline' } })
    },
  }
}
