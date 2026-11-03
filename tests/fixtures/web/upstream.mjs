import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { Server, ServerResponse } from 'node:http'
import process from 'node:process'
// No network leaves this test process. Record each actual attempt, including fallbacks.
globalThis.fetch = async (_url, options) => {
  const body = JSON.parse(options.body)
  appendFileSync(process.env.ANNA_TEST_UPSTREAM_LOG, `${body.model}\n`)
  const status = body.messages?.[0]?.content === 'fallback' && body.model === 'primary' ? 429 : 200
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), { status })
}

// Advance only the server's wall clock; keep IPC and HTTP real and sweep idle sessions quickly.
const now = Date.now
Date.now = () => now() + Number(readFileSync(process.env.ANNA_TEST_CLOCK, 'utf8'))
const interval = globalThis.setInterval
globalThis.setInterval = (callback, milliseconds, ...args) => interval(callback, milliseconds === 60000 ? 20 : milliseconds, ...args)

// Observe completion of the real close handlers so the test can advance its clock without a timing guess.
const writeHead = ServerResponse.prototype.writeHead
ServerResponse.prototype.writeHead = function (...args) {
  if (args[1]?.['Content-Type'] === 'text/event-stream')
    this.once('close', () => queueMicrotask(() => writeFileSync(process.env.ANNA_TEST_CLOSED, 'closed')))
  return writeHead.apply(this, args)
}

// Record when every partial upload has actually arrived, rather than guessing from a fixed delay.
const emit = Server.prototype.emit
Server.prototype.emit = function (event, ...args) {
  if (event === 'request' && args[0].url.endsWith('/chat/completions'))
    args[0].once('data', () => appendFileSync(process.env.ANNA_TEST_REQUESTS, 'arrived\n'))
  return emit.call(this, event, ...args)
}
