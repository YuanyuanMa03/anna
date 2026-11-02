import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
// A deterministic IPC core: the HTTP server, session setup and relay remain real.
writeFileSync(join(process.env.ANNA_CORE_DATA, 'relay-token'), process.env.ANNA_RELAY_TOKEN)
process.on('message', (message) => {
  if (message.kind !== 'call')
    return
  process.send({ kind: 'reply', id: message.id, ok: true, value: message.method === 'busy' ? false : {} })
  if (message.method === 'shutdown')
    setTimeout(() => process.exit(0), 10)
})
process.on('disconnect', () => process.exit(0))
process.send({ kind: 'event', event: { type: 'core', status: 'ready' } })
