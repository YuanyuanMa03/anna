import type { Command } from '../../packages/shared/contracts'
import type { Wire } from '../../packages/shared/rpc'
import process from 'node:process'
import { Host } from '../../packages/anna-host/host'
import { RpcPeer } from '../../packages/shared/rpc'

/**
 * One visitor's Anna: a whole Host (pi kernel, command sandbox, approvals, checkpoints, memory, delegation) in its
 * own process and, in the Studio, under its own Unix user. The sandbox manager is process-wide, so visitors cannot
 * share a process. This process never holds the Studio's ModelScope key: its model and agent providers point at the
 * server's inference relay with a per-visitor relay token.
 */
const root = process.env.ANNA_CORE_ROOT!
const data = process.env.ANNA_CORE_DATA!
const relayToken = process.env.ANNA_RELAY_TOKEN!
delete process.env.ANNA_RELAY_TOKEN
let host: Host | undefined
let markReady!: () => void
const ready = new Promise<void>((resolve) => { markReady = resolve })
// Provider keys (the relay token for Claude Code and Codex) live only in this process's memory.
let providerKeys = process.env.ANNA_PROVIDER_KEYS ?? ''
delete process.env.ANNA_PROVIDER_KEYS

const peer = new RpcPeer(message => process.send!(message), {
  execute: async (command: Command) => {
    await ready
    return host!.execute(command)
  },
  busy: async () => Boolean(host?.busy),
  shutdown: async () => {
    await host?.shutdown().catch(() => {})
    setTimeout(() => process.exit(0), 50)
  },
})
process.on('message', message => void peer.receive(message as Wire))
process.on('disconnect', () => { void host?.shutdown().finally(() => process.exit(0)) })

async function main() {
  host = new Host(root, data, { read: async () => relayToken, write: async () => {} }, event => peer.event(event), {
    secrets: { read: async () => providerKeys, write: async (value) => { providerKeys = value } },
    secretsMode: async () => 'file',
  })
  await host.initialize()
  markReady()
  peer.event({ type: 'core', status: 'ready' })
}

process.on('uncaughtException', (error) => { console.error('[anna-web-core]', error); process.exit(1) })
void main().catch((error) => {
  console.error('[anna-web-core] startup failed', error)
  process.exit(1)
})
