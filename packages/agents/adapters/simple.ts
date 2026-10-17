import type { Decoded, Decoder } from './types'
import { nothing } from './types'

/**
 * Decoders for agents whose headless mode cannot ask for permission mid-run (approval is given up front, and the
 * agent's own approval level is set from Anna's mode). Schemas:
 * - Gemini CLI: packages/core/src/output/types.ts (init/message/tool_use/tool_result/error/result)
 * - OpenCode: packages/cli/src/run/noninteractive.ts ({ type, timestamp, sessionID, part })
 * - Pi: docs/json.md (session header + AgentSessionEvent stream)
 */
function noAnswer(): string { throw new Error('this agent does not ask for permission mid-run') }

const geminiTools: Record<string, string> = { read_file: 'read', read_many_files: 'read', write_file: 'write', replace: 'edit', edit: 'edit', run_shell_command: 'bash', search_file_content: 'grep', grep: 'grep', glob: 'find', list_directory: 'ls', ls: 'ls' }

export function geminiDecoder(): Decoder {
  const names = new Map<string, string>()
  let text = ''
  return {
    decode(line): Decoded {
      let event: any
      try { event = JSON.parse(line) }
      catch { return nothing() }
      const out: Decoded = { events: [] }
      if (event.type === 'init') {
        out.sessionId = event.session_id
      }
      else if (event.type === 'message' && event.role === 'assistant') {
        text = event.delta ? text + event.content : event.content
        out.events.push({ type: 'text', text })
      }
      else if (event.type === 'tool_use') {
        const name = geminiTools[event.tool_name] ?? `gemini:${event.tool_name}`
        const params = event.parameters ?? {}
        names.set(event.tool_id, name)
        out.events.push({ type: 'tool-start', id: event.tool_id, name, input: { ...params, path: params.absolute_path ?? params.file_path ?? params.path ?? params.dir_path } })
      }
      else if (event.type === 'tool_result') {
        out.events.push({ type: 'tool-end', id: event.tool_id, name: names.get(event.tool_id) ?? 'tool', output: event.output ?? event.error?.message ?? '', isError: event.status !== 'success' })
      }
      else if (event.type === 'result') {
        out.done = { text: text || event.error?.message || '', isError: event.status !== 'success' }
      }
      return out
    },
    answer: noAnswer,
  }
}

const opencodeTools: Record<string, string> = { read: 'read', write: 'write', edit: 'edit', patch: 'edit', bash: 'bash', grep: 'grep', glob: 'find', list: 'ls' }

export function opencodeDecoder(): Decoder {
  let text = ''
  let failed = false
  return {
    decode(line): Decoded {
      let event: any
      try { event = JSON.parse(line) }
      catch { return nothing() }
      const out: Decoded = { events: [], sessionId: event.sessionID }
      const part = event.part ?? {}
      if (event.type === 'tool_use') {
        const name = opencodeTools[part.tool] ?? `opencode:${part.tool}`
        const input = part.state?.input ?? {}
        const id = part.callID ?? part.id ?? `${event.timestamp}`
        out.events.push({ type: 'tool-start', id, name, input: { ...input, path: input.filePath ?? input.path } })
        if (part.state?.status === 'completed' || part.state?.status === 'error')
          out.events.push({ type: 'tool-end', id, name, output: part.state.output ?? part.state.error ?? '', isError: part.state.status === 'error' })
      }
      else if (event.type === 'text' && part.text) {
        text = part.text
        out.events.push({ type: 'text', text })
      }
      else if (event.type === 'reasoning') {
        out.events.push({ type: 'thinking' })
      }
      else if (event.type === 'error') {
        failed = true
      }
      else if (event.type === 'step_finish' && part.reason !== 'tool-calls') {
        out.done = { text, isError: failed }
      }
      return out
    },
    answer: noAnswer,
  }
}

export function piDecoder(): Decoder {
  let text = ''
  return {
    decode(line): Decoded {
      let event: any
      try { event = JSON.parse(line) }
      catch { return nothing() }
      const out: Decoded = { events: [] }
      switch (event.type) {
        case 'session': out.sessionId = event.id; break
        case 'agent_start': out.events.push({ type: 'thinking' }); break
        case 'message_start': if (event.message?.role === 'assistant')
          text = ''; break
        case 'message_update':
          if (event.assistantMessageEvent?.type === 'text_delta') {
            text += event.assistantMessageEvent.delta
            out.events.push({ type: 'text', text })
          }
          break
        case 'tool_execution_start': out.events.push({ type: 'tool-start', id: event.toolCallId, name: event.toolName, input: event.args ?? {} }); break
        case 'tool_execution_end': out.events.push({ type: 'tool-end', id: event.toolCallId, name: event.toolName, output: (event.result?.content ?? []).map((block: { text?: string }) => block.text ?? '').join('\n'), isError: Boolean(event.isError) }); break
        case 'compaction_start': out.events.push({ type: 'compacting', active: true }); break
        case 'compaction_end': out.events.push({ type: 'compacting', active: false }); break
        case 'auto_retry_start': out.events.push({ type: 'retrying', attempt: event.attempt }); break
        case 'agent_settled': out.done = { text, isError: Boolean(event.aborted) }; break
      }
      return out
    },
    answer: noAnswer,
  }
}
