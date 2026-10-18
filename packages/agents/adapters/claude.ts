import type { KernelEvent } from '../../kernels/types'
import type { Decoded, Decoder } from './types'
import { nothing } from './types'

/** Claude Code tool names → Anna's normalized tools and input fields. */
export function normalizeClaudeTool(name: string, input: Record<string, unknown>): { name: string, input: Record<string, unknown> } {
  const path = input.file_path ?? input.notebook_path ?? input.path
  switch (name) {
    case 'Read': return { name: 'read', input: { ...input, path } }
    case 'Write': return { name: 'write', input: { ...input, path } }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': return { name: 'edit', input: { ...input, path } }
    case 'Bash': return { name: 'bash', input }
    case 'Grep': return { name: 'grep', input: { ...input, path: input.path } }
    case 'Glob': return { name: 'find', input: { ...input, path: input.path } }
    case 'LS': return { name: 'ls', input: { ...input, path } }
    default: {
      // Anna's own tools, served to Claude Code over MCP, keep their own names (and their own rules) at Anna's gate.
      const own = /^mcp__anna__(anna_\w+)$/.exec(name)
      return { name: own ? own[1]! : `claude:${name}`, input }
    }
  }
}

interface Block { type: string, id?: string, name?: string, input?: Record<string, unknown>, text?: string, tool_use_id?: string, content?: unknown, is_error?: boolean }

function blockText(content: unknown): string {
  if (typeof content === 'string')
    return content
  if (Array.isArray(content))
    return content.map(item => typeof item === 'string' ? item : (item as { text?: string }).text ?? '').join('\n')
  return ''
}

/**
 * `claude -p --input-format stream-json --output-format stream-json --verbose --permission-prompt-tool stdio`:
 * assistant/user messages carry tool_use / tool_result blocks; permission prompts arrive as control_request
 * (subtype can_use_tool) and are answered with control_response on stdin.
 */
export function claudeDecoder(): Decoder {
  const names = new Map<string, string>()
  let text = ''
  return {
    decode(line: string): Decoded {
      let message: any
      try { message = JSON.parse(line) }
      catch { return nothing() }
      const out: Decoded = { events: [] }
      if (message.session_id)
        out.sessionId = message.session_id
      if (message.type === 'assistant') {
        for (const block of (message.message?.content ?? []) as Block[]) {
          if (block.type === 'thinking') {
            out.events.push({ type: 'thinking' })
          }
          else if (block.type === 'text' && block.text) {
            text = text ? `${text}\n\n${block.text}` : block.text
            out.events.push({ type: 'text', text })
          }
          else if (block.type === 'tool_use' && block.id && block.name) {
            const tool = normalizeClaudeTool(block.name, block.input ?? {})
            names.set(block.id, tool.name)
            text = ''
            out.events.push({ type: 'tool-start', id: block.id, name: tool.name, input: tool.input })
          }
        }
      }
      else if (message.type === 'user') {
        for (const block of (Array.isArray(message.message?.content) ? message.message.content : []) as Block[]) {
          if (block.type === 'tool_result' && block.tool_use_id)
            out.events.push({ type: 'tool-end', id: block.tool_use_id, name: names.get(block.tool_use_id) ?? 'tool', output: blockText(block.content), isError: Boolean(block.is_error) })
        }
      }
      else if (message.type === 'control_request' && message.request?.subtype === 'can_use_tool') {
        const tool = normalizeClaudeTool(message.request.tool_name, message.request.input ?? {})
        out.approval = { id: message.request_id, tool: tool.name, input: tool.input, raw: message.request }
      }
      else if (message.type === 'system' && message.subtype === 'compact_boundary') {
        out.events.push({ type: 'compacting', active: false })
      }
      else if (message.type === 'result') {
        out.done = { text: typeof message.result === 'string' ? message.result : text, isError: Boolean(message.is_error) || message.subtype !== 'success' }
      }
      return out
    },
    answer(approval, decision) {
      const original = (approval.raw as { input?: Record<string, unknown> }).input ?? {}
      const response = decision.allow ? { behavior: 'allow', updatedInput: original } : { behavior: 'deny', message: decision.reason ?? '用户没有批准这次操作。' }
      return JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: approval.id, response } })
    },
  }
}

export type { KernelEvent }
