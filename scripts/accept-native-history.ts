import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { withCodex } from '../packages/agents/codex-rpc'
import { Host } from '../packages/anna-host/host'

/** Only forks the synthetic session created by accept-native-brains. No model request. */
async function main() {
  const brain = process.argv[2]
  const data = resolve(process.argv[3] ?? '')
  assert(brain === 'codex' || brain === 'claude-code')
  const accepted = JSON.parse(await readFile(`artifacts/native-${brain}.json`, 'utf8'))
  assert.equal(accepted.data, data, 'Only the acceptance-created session may be branched')
  assert(!accepted.error && accepted.checks.length === 4, 'Native task acceptance must pass first')
  const agent = brain === 'codex' ? 'codex' : 'claude'
  const host = new Host(resolve('.'), data, { read: async () => '', write: async () => {} }, () => {})
  const evidence: Record<string, unknown> = { brain, data }
  try {
    await host.initialize()
    await host.execute({ type: 'connect' })
    const original = host.snapshot().sessionId
    assert(original)
    await host.execute({ type: 'history-list', agent })
    assert(host.snapshot().externalHistory?.items.some(item => item.id === original), 'Original missing from scoped list')
    await host.execute({ type: 'history-preview', agent, id: original })
    const before = host.snapshot().externalHistory?.preview?.messages
    assert(before?.length)
    let path: string | undefined
    if (agent === 'codex') {
      path = await withCodex({ command: 'codex' }, host.workspacePath, async request => (await request('thread/read', { threadId: original, includeTurns: false })).thread.path)
    }
    else {
      const { listSessions } = await import('@anthropic-ai/claude-agent-sdk')
      const info = (await listSessions({ dir: host.workspacePath, limit: 20 })).find(item => item.sessionId === original)
      assert(info)
      evidence.originalBytes = info.fileSize
    }
    const hash = async () => path ? createHash('sha256').update(await readFile(path)).digest('hex') : undefined
    const beforeHash = await hash()
    await host.execute({ type: 'history-fork', agent, id: original })
    const forked = host.snapshot().sessionId
    assert(forked && forked !== original)
    await host.execute({ type: 'history-preview', agent, id: original })
    assert.deepEqual(host.snapshot().externalHistory?.preview?.messages, before)
    if (beforeHash) {
      assert.equal(await hash(), beforeHash)
    }
    else {
      const { listSessions } = await import('@anthropic-ai/claude-agent-sdk')
      const info = (await listSessions({ dir: host.workspacePath, limit: 20 })).find(item => item.sessionId === original)
      assert.equal(info?.fileSize, evidence.originalBytes)
    }
    const transcript = JSON.parse(await readFile(host.snapshot().settings.sessionFile!, 'utf8'))
    assert.equal(transcript.source.id, original)
    assert.equal(transcript.agentSessionId, forked)
    evidence.checks = ['scoped native history list and preview', 'native fork created a distinct session', 'source transcript remained unchanged', 'Anna provenance saved in branch transcript']
    evidence.original = original
    evidence.forked = forked
  }
  catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error)
    throw error
  }
  finally {
    await host.close()
    await writeFile(join('artifacts', `history-${brain}.json`), JSON.stringify(evidence, null, 2))
  }
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
