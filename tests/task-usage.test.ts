import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { expect, it } from 'vitest'
import { claudeDecoder } from '../packages/agents/adapters/claude'
import { codexDecoder } from '../packages/agents/adapters/codex'
import { runAgent } from '../packages/agents/runner'
import { Presence } from '../packages/anna-host/presence'

it('sums distinct model calls and replaces duplicate usage reports', () => {
  const presence = new Presence(() => {})
  presence.beginTurn()
  presence.handle({ type: 'usage', id: 'one', tokens: { input: 10, output: 3, cacheRead: 20 } })
  presence.handle({ type: 'usage', id: 'one', tokens: { input: 10, output: 3, cacheRead: 20 } })
  presence.handle({ type: 'usage', id: 'review', tokens: { input: 2, output: 4 } })
  expect(presence.usage).toEqual({ input: 12, output: 7, cacheRead: 20, partial: false })
  presence.handle({ type: 'usage', id: 'missing' })
  expect(presence.usage?.partial).toBe(true)
  presence.beginTurn()
  expect(presence.usage).toBeUndefined()
})

it('reads Claude result usage separately from message text', () => {
  const decoded = claudeDecoder().decode(JSON.stringify({ type: 'result', subtype: 'success', result: 'done', usage: { input_tokens: 3, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 11 } }))
  expect(decoded.usage).toEqual({ input: 3, output: 5, cacheRead: 7, cacheWrite: 11 })
})

it('normalizes Codex cached input without counting it twice', () => {
  const decoded = codexDecoder().decode(JSON.stringify({ method: 'thread/tokenUsage/updated', params: { tokenUsage: { total: { inputTokens: 40, cachedInputTokens: 30, outputTokens: 5 } } } }))
  expect(decoded.cumulativeUsage).toEqual({ input: 10, cacheRead: 30, output: 5 })
})

it('uses a stored Codex baseline and does not recount repeated cumulative notifications', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'anna-usage-'))
  const file = join(cwd, 'codex.mjs')
  await writeFile(file, `import { createInterface } from 'node:readline';
const out = value => process.stdout.write(JSON.stringify(value) + '\\n');
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') out({ id: message.id, result: {} });
  if (message.method === 'thread/resume' || message.method === 'thread/start') out({ id: message.id, result: { thread: { id: 'test' } } });
  if (message.method === 'turn/start') {
    const usage = { method: 'thread/tokenUsage/updated', params: { tokenUsage: { total: { inputTokens: 40, cachedInputTokens: 20, outputTokens: 15 } } } };
    out(usage); out(usage);
    out({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
  }
});`)
  for (const baseline of [{ input: 10, output: 5, cacheRead: 10 }, undefined]) {
    const presence = new Presence(() => {})
    const result = await runAgent({ agent: 'codex', command: process.execPath, prefix: [file], cwd, sessionId: 'previous', usageBaseline: baseline, launch: { args: [], env: {}, stdin: [], prompt: 'hello' }, gate: async () => ({ allow: false }), emit: event => presence.handle(event) })
    expect(result.status).toBe('completed')
    expect(result.cumulativeUsage).toEqual({ input: 20, cacheRead: 20, output: 15 })
    if (baseline)
      expect(presence.usage).toEqual({ input: 10, output: 10, cacheRead: 10, partial: false })
    else expect(presence.usage).toEqual({ partial: true })
  }
})

it('counts reported retries and actual failovers, excludes exhausted routing notices and resets each task', () => {
  const presence = new Presence(() => {})
  presence.beginTurn()
  presence.handle({ type: 'retrying', attempt: 1 })
  presence.handle({ type: 'failover', line: 'switch', retry: true })
  presence.handle({ type: 'failover', line: 'exhausted', retry: false })
  expect(presence.stats.retries).toBe(2)
  presence.beginTurn()
  expect(presence.stats.retries).toBe(0)
})
