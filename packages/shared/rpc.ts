/** Minimal request/response + event protocol between Electron main and the Anna core utility process. */
export type Wire
  = | { kind: 'call', id: number, method: string, params: unknown }
    | { kind: 'reply', id: number, ok: true, value: unknown }
    | { kind: 'reply', id: number, ok: false, error: string }
    | { kind: 'event', event: unknown }

export type Handlers = Record<string, (params: any) => Promise<unknown> | unknown>

export class RpcPeer {
  private next = 1
  private closed?: string
  private pending = new Map<number, { resolve: (value: any) => void, reject: (error: Error) => void }>()
  constructor(private post: (message: Wire) => void, private handlers: Handlers, private onEvent: (event: any) => void = () => {}) {}

  async receive(message: Wire) {
    if (message.kind === 'event') {
      this.onEvent(message.event)
    }
    else if (message.kind === 'reply') {
      const pending = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (pending)
        message.ok ? pending.resolve(message.value) : pending.reject(new Error(message.error))
    }
    else {
      const handler = this.handlers[message.method]
      try {
        if (!handler)
          throw new Error(`Unknown method ${message.method}`)
        this.post({ kind: 'reply', id: message.id, ok: true, value: await handler(message.params) })
      }
      catch (error) { this.post({ kind: 'reply', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }) }
    }
  }

  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed)
      return Promise.reject(new Error(this.closed))
    const id = this.next++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.post({ kind: 'call', id, method, params })
    })
  }

  event(event: unknown) { this.post({ kind: 'event', event }) }

  /** Fail every in-flight call and refuse new ones, e.g. when the other side exits. */
  fail(reason: string) {
    this.closed = reason
    for (const pending of this.pending.values()) pending.reject(new Error(reason))
    this.pending.clear()
  }
}
