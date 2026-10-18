import type { KernelEvent } from '../kernels/types'
import type { DelegateAgent } from './adapters'
import type { Launch } from './launch'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, dirname } from 'node:path'
import process from 'node:process'
import { decoderFor } from './adapters'

export interface RunOptions {
  agent: DelegateAgent
  /** Executable plus fixed leading arguments (tests run a fake agent through node). */
  command: string
  prefix?: string[]
  launch: Launch
  cwd: string
  /** Continue this session (codex resumes the thread over JSON-RPC; others pass it in launch args). */
  sessionId?: string
  gate: (tool: string, input: Record<string, unknown>) => Promise<{ allow: boolean, reason?: string }>
  emit: (event: KernelEvent) => void
  signal?: AbortSignal
}

export interface RunResult { status: 'completed' | 'failed' | 'aborted', text: string, sessionId?: string, error?: string }

/**
 * Run one delegated turn of an external agent: start the process, decode its stream into Anna events, route its
 * permission requests through Anna's gate, and resolve when the turn finishes.
 */
export function runAgent(options: RunOptions): Promise<RunResult> {
  const { agent, command, launch, cwd } = options
  const decoder = decoderFor(agent)
  for (const [path, text] of Object.entries(launch.files ?? {})) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, text, { mode: 0o600 })
  }
  const child = spawn(command, [...(options.prefix ?? []), ...launch.args], {
    cwd,
    windowsHide: true,
    shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command),
    env: { ...process.env, ...launch.env, PATH: [dirname(command), process.env.PATH].filter(Boolean).join(delimiter), NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const write = (line: string) => {
    if (!child.stdin.destroyed)
      child.stdin.write(`${line}\n`)
  }
  let sessionId = options.sessionId
  let stderr = ''
  let settled = false
  let rpc = 1
  return new Promise<RunResult>((resolve) => {
    const finish = (result: RunResult) => {
      if (settled)
        return
      settled = true
      child.stdin.end()
      setTimeout(() => child.kill(), agent === 'codex' ? 200 : 2000)
      resolve({ ...result, sessionId: result.sessionId ?? sessionId })
    }
    options.signal?.addEventListener('abort', () => {
      child.kill()
      finish({ status: 'aborted', text: '' })
    }, { once: true })
    // codex app-server handshake: initialize → initialized → thread/start|resume → turn/start.
    const request = (method: string, params: unknown) => write(JSON.stringify({ id: rpc++, method, params }))
    if (agent === 'codex')
      request('initialize', { clientInfo: { name: 'anna', title: 'Anna', version: '0.4.0' }, capabilities: null })
    for (const line of launch.stdin) write(JSON.stringify(line))
    if (agent !== 'codex' && agent !== 'claude')
      child.stdin.end()

    let buffer = ''
    const handle = async (line: string) => {
      if (agent === 'codex') {
        const message = JSON.parse(line)
        if (message.id === 1 && message.result) {
          write(JSON.stringify({ method: 'initialized' }))
          if (options.sessionId)
            request('thread/resume', { threadId: options.sessionId, cwd, ...launch.thread })
          else
            request('thread/start', { cwd, ...launch.thread })
        }
        else if (message.id === 2 && message.result?.thread?.id) {
          request('turn/start', { threadId: message.result.thread.id, input: [{ type: 'text', text: launch.prompt ?? '', text_elements: [] }] })
        }
        else if (message.id !== undefined && message.error && !message.method) {
          finish({ status: 'failed', text: '', error: message.error.message ?? JSON.stringify(message.error) })
          return
        }
      }
      const decoded = decoder.decode(line)
      if (decoded.sessionId)
        sessionId = decoded.sessionId
      for (const event of decoded.events) options.emit(event)
      if (decoded.approval) {
        const verdict = await options.gate(decoded.approval.tool, decoded.approval.input)
        write(decoder.answer(decoded.approval, verdict))
      }
      if (decoded.done)
        finish({ status: decoded.done.isError ? 'failed' : 'completed', text: decoded.done.text, error: decoded.done.isError ? decoded.done.text : undefined })
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
        const line = buffer.slice(0, index).replace(/\r$/, '')
        buffer = buffer.slice(index + 1)
        if (line.trim())
          handle(line).catch(error => finish({ status: 'failed', text: '', error: String(error) }))
      }
    })
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000) })
    child.on('error', error => finish({ status: 'failed', text: '', error: error.message }))
    child.on('exit', code => finish({ status: code === 0 ? 'completed' : 'failed', text: '', error: code === 0 ? undefined : stderr.trim().split('\n').slice(-3).join('\n') || `进程退出，代码 ${code}` }))
  })
}
