import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { Host } from '../packages/anna-host/host'

/** Opt-in real logged-in agent acceptance. Never invoked by unit tests or the benchmark. */
async function main() {
  const brain = process.argv[2]
  assert(brain === 'claude-code' || brain === 'codex', 'Specify claude-code or codex')
  const existingLogin = process.argv.includes('--existing-login')
  // Test the saved native login without inherited shell provider/model overrides. Never change user files.
  if (existingLogin && brain === 'claude-code') {
    for (const name of Object.keys(process.env)) {
      if (name.startsWith('ANTHROPIC_') || name === 'CLAUDE_CODE_SUBAGENT_MODEL')
        delete process.env[name]
    }
  }
  await mkdir('.data', { recursive: true })
  await mkdir('artifacts', { recursive: true })
  const data = await mkdtemp(resolve(`.data/real-${brain}-`))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  await writeFile(join(workspace, 'input.txt'), 'Synthetic acceptance input.\n')
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: brain, characterId: 'haru', statusEnabled: true, memoryEnabled: false, model: { provider: 'custom', model: 'unused', baseURL: 'https://unused.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'edit', rules: { allow: [], ask: [], deny: [] } } } }))
  const evidence: { brain: string, data: string, existingLogin: boolean, checks: string[], results: unknown[], error?: string } = { brain, data, existingLogin, checks: [], results: [] }
  let reject = false
  let cancelled = false
  let cancelOnTool = false
  const seenApprovals = new Set<string>()
  function create() {
    const host = new Host(resolve('.'), data, { read: async () => '', write: async () => {} }, (event) => {
      if (event.type === 'snapshot') {
        for (const approval of event.snapshot.approvals) {
          if (seenApprovals.has(approval.id))
            continue
          seenApprovals.add(approval.id)
          queueMicrotask(() => { void host.execute({ type: 'approval', id: approval.id, allow: !reject }).catch(() => {}) })
        }
      }
      if (event.type === 'tool' && event.phase === 'call' && cancelOnTool && !cancelled) {
        cancelled = true
        setTimeout(() => { void host.execute({ type: 'stop' }) }, 300)
      }
    })
    return host
  }
  let host = create()
  async function send(text: string) {
    const timer = setTimeout(() => { void host.execute({ type: 'stop' }) }, 180_000)
    try {
      await host.execute({ type: 'send', text })
      const result = host.snapshot().result
      evidence.results.push(result)
      assert(result, 'No result was returned')
      return host.snapshot()
    }
    finally { clearTimeout(timer) }
  }
  try {
    await host.initialize()
    const token = randomUUID()
    let state = await send(`这是临时工程验收。请读取 input.txt，然后用文件工具创建 result.md，内容为 NATIVE_WORK_OK。另有会话口令 ${token}，只在会话里保留，不写入文件。不要安装依赖。`)
    assert.equal(state.result?.status, 'completed', state.error)
    assert.match(await readFile(join(workspace, 'result.md'), 'utf8'), /NATIVE_WORK_OK/)
    assert(state.sessionId, 'Missing native session id')
    const session = state.sessionId
    evidence.checks.push('real task: read, write, result collection and native session id')
    await host.close()
    host = create()
    await host.initialize()
    state = await send('之前的会话口令是什么？请仅根据会话回答，不读文件。')
    assert.equal(state.sessionId, session)
    assert(state.messages?.at(-1)?.text.includes(token), 'The native session did not recall its token')
    evidence.checks.push('full Host restart resumed the same native session with conversation continuity')
    await host.execute({ type: 'mode', mode: 'ask' })
    reject = true
    const approvals = seenApprovals.size
    await send('工程验收：请尝试用文件工具创建 blocked.txt。如果权限被拒绝，立即停止，不换工具、不重试，只解释被拒绝。')
    assert(seenApprovals.size > approvals, 'The write did not request approval')
    await assert.rejects(stat(join(workspace, 'blocked.txt')))
    evidence.checks.push('rejected native file approval left the target absent')
    reject = false
    await host.execute({ type: 'mode', mode: 'edit' })
    cancelOnTool = true
    state = await send('工程验收：请先用终端执行 sleep 30，等待完成后再创建 cancelled.txt。不要并行执行。')
    assert(cancelled, 'No tool call was observed before cancellation')
    assert.equal(state.result?.status, 'aborted')
    await assert.rejects(stat(join(workspace, 'cancelled.txt')))
    evidence.checks.push('cancellation during tool execution returned aborted without creating the later file')
  }
  catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error)
    throw error
  }
  finally {
    await host.close()
    await writeFile(`artifacts/native-${brain}.json`, JSON.stringify(evidence, null, 2))
  }
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
