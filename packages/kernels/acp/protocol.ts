import type { ChildProcess } from 'node:child_process'
import type { GateVerdict } from '../types'
import { createInterface } from 'node:readline'

/**
 * The Agent Client Protocol (https://agentclientprotocol.com): JSON-RPC 2.0, one message per line on the agent's
 * stdin and stdout. Anna is the client: she starts sessions and prompts; the agent streams `session/update`
 * notifications and asks `session/request_permission` before a tool runs.
 */

/** ACP tool kinds onto Anna's normalized tool names (what her gate and presence understand). */
const toolNamesByKind: Record<string, string> = { read: 'read', edit: 'edit', delete: 'edit', move: 'edit', search: 'grep', execute: 'bash', fetch: 'fetch', think: 'think' }
export function toolName(kind: string | undefined) {
  return (kind && toolNamesByKind[kind]) || 'other'
}

export interface AcpToolCall { toolCallId: string, title?: string, kind?: string, rawInput?: Record<string, unknown>, locations?: { path: string }[] }
/**
 * A tool call's input in Anna's terms: the command for a shell call, the path for a file call. A file call whose path
 * cannot be told is judged as outside the workspace ('/'), so her gate asks instead of waving it through.
 */
export function toolInput(call: AcpToolCall): Record<string, unknown> {
  const raw = call.rawInput ?? {}
  if (toolName(call.kind) === 'bash')
    return { command: String(raw.command ?? raw.cmd ?? call.title ?? '') }
  const path = call.locations?.[0]?.path ?? raw.path ?? raw.file_path ?? raw.filePath
  return { ...raw, path: path === undefined ? '/' : String(path) }
}

/** The text a tool call produced, from ACP content blocks (text, or a diff shown by its path). */
export function toolOutput(content: unknown) {
  if (!Array.isArray(content))
    return ''
  return content.map((block: { type?: string, content?: { text?: string }, path?: string } | null) => block?.type === 'diff' ? `diff ${block.path ?? ''}` : block?.content?.text ?? '').filter(Boolean).join('\n')
}

export interface PermissionOption { optionId: string, kind: string }
/**
 * Anna's gate decides each call by itself: allowed means the agent's allow-once option, refused its reject-once option.
 * "Always" options are never picked, so the agent keeps asking and every later call still passes the gate.
 */
export function permissionOutcome(verdict: GateVerdict, options: PermissionOption[]) {
  const pick = options.find(option => option.kind === (verdict.allow ? 'allow_once' : 'reject_once'))
  return pick ? { outcome: 'selected' as const, optionId: pick.optionId } : { outcome: 'cancelled' as const }
}

export class AcpError extends Error {
  constructor(message: string, readonly code?: number) { super(message) }
}

/** One JSON-RPC connection to an agent process: requests both ways, notifications both ways. */
export class Connection {
  private next = 1
  private pending = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()
  /** Why the agent is gone (it failed to start or exited); every request from then on fails with it. */
  private ended?: AcpError
  constructor(private child: ChildProcess, private handlers: { request: (method: string, params: any) => Promise<unknown>, notify: (method: string, params: any) => void }) {
    createInterface({ input: child.stdout! }).on('line', line => this.receive(line))
    // Writing to an agent that just died: the exit below is what reports it.
    child.stdin?.on('error', () => {})
    child.on('error', error => this.end(new AcpError(`启动失败（${error.message}）`)))
    child.on('exit', code => this.end(new AcpError(`进程已退出（${code ?? '被终止'}）`)))
  }

  private end(reason: AcpError) {
    this.ended ??= reason
    for (const { reject } of this.pending.values())
      reject(this.ended)
    this.pending.clear()
  }

  request<T = any>(method: string, params: unknown): Promise<T> {
    if (this.ended)
      return Promise.reject(this.ended)
    const id = this.next++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.write({ id, method, params })
    })
  }

  notify(method: string, params: unknown) { this.write({ method, params }) }

  private write(message: Record<string, unknown>) {
    if (this.child.stdin?.writable)
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  }

  private receive(line: string) {
    let message: { id?: number | string, method?: string, params?: unknown, result?: unknown, error?: { code?: number, message?: string } }
    try { message = JSON.parse(line) }
    catch { return } // agents may log to stdout; anything that is not JSON-RPC is ignored
    if (!message || typeof message !== 'object')
      return
    if (message.method && message.id !== undefined) {
      const id = message.id
      this.handlers.request(message.method, message.params).then(
        result => this.write({ id, result }),
        (error: Error) => this.write({ id, error: { code: -32603, message: error.message } }),
      )
    }
    else if (message.method) {
      this.handlers.notify(message.method, message.params)
    }
    else if (typeof message.id === 'number' && this.pending.has(message.id)) {
      const waiter = this.pending.get(message.id)!
      this.pending.delete(message.id)
      if (message.error)
        waiter.reject(new AcpError(message.error.message ?? '出错了', message.error.code))
      else waiter.resolve(message.result)
    }
  }
}
