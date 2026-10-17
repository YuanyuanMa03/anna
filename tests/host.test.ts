import type { ScriptStep } from '../packages/kernels/pi/backend'
import type { AnnaEvent, PermissionMode } from '../packages/shared/contracts'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { expect, it, vi } from 'vitest'
import { Host } from '../packages/anna-host/host'
import { scriptedBackend } from '../packages/kernels/pi/backend'
import { createPiKernel } from '../packages/kernels/pi/kernel'

/** A host with a real pi kernel driven by a scripted model. `script` is consumed across turns. */
async function setup(script: ScriptStep[], options: { mode?: PermissionMode, trusted?: boolean } = {}) {
  const data = await mkdtemp(join(tmpdir(), 'anna-host-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  await writeFile(join(workspace, 'tasks.txt'), 'alpha\nbeta\n')
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'hiyori', statusEnabled: true, memoryEnabled: true, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: options.trusted === false ? {} : { [workspace]: { trusted: true, mode: options.mode ?? 'edit', rules: { allow: [], ask: [], deny: [] } } } }))
  let backend: Awaited<ReturnType<typeof scriptedBackend>> | undefined
  const events: AnnaEvent[] = []
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, event => events.push(event), {
    sandbox: { available: false, reason: 'test' },
    kernel: (context) => {
      const kernel = createPiKernel(context, undefined)
      const start = kernel.start.bind(kernel)
      kernel.start = async () => {
        backend ??= await scriptedBackend(script, data)
        ;(kernel as unknown as { backend: unknown }).backend = backend
        return start()
      }
      return kernel
    },
  })
  await host.initialize()
  return { host, data, workspace, events }
}
async function approve(host: Host, scope: 'once' | 'session' | 'always' = 'once', allow = true) {
  await vi.waitUntil(() => host.snapshot().approvals.length > 0, { timeout: 5000, interval: 10 })
  const question = host.snapshot().approvals[0]!
  await host.execute({ type: 'approval', id: question.id, allow, scope })
  return question
}

it('edit mode: works in the workspace, records changes, and undo restores them', async () => {
  const { host, workspace, events } = await setup([
    { tools: [{ name: 'read', args: { path: 'tasks.txt' } }] },
    { tools: [{ name: 'edit', args: { path: 'tasks.txt', edits: [{ oldText: 'alpha', newText: 'ALPHA' }] } }, { name: 'write', args: { path: 'result.md', content: 'ANNA_WORK_OK' } }] },
    { text: '完成了，改了两个文件。' },
  ])
  await host.execute({ type: 'send', text: '读 tasks 并整理' })
  const snapshot = host.snapshot()
  expect(snapshot.result).toMatchObject({ status: 'completed', ok: true })
  expect(snapshot.result!.changes.map(change => `${change.status}:${change.path}`).sort()).toEqual(['added:result.md', 'modified:tasks.txt'])
  expect(snapshot.messages!.map(message => message.role)).toEqual(['user', 'assistant'])
  expect(events.filter(event => event.type === 'anna').map(event => event.type === 'anna' && event.state.phase)).toEqual(expect.arrayContaining(['thinking', 'inspecting', 'editing', 'done']))
  await host.execute({ type: 'changes', taskId: snapshot.result!.taskId })
  const diff = events.find(event => event.type === 'changes')
  expect(diff?.type === 'changes' && diff.changes.find(change => change.path === 'tasks.txt')?.patch).toContain('+ALPHA')
  await host.execute({ type: 'undo', taskId: snapshot.result!.taskId })
  expect(await readFile(join(workspace, 'tasks.txt'), 'utf8')).toBe('alpha\nbeta\n')
  expect(existsSync(join(workspace, 'result.md'))).toBe(false)
  expect(host.snapshot().result?.undone).toBe(true)
  await host.close()
})

it('ask mode: approvals with session scope stop asking for the same file; rejections are reported', async () => {
  const { host, workspace } = await setup([
    { tools: [{ name: 'write', args: { path: 'a.txt', content: '1' } }] },
    { tools: [{ name: 'write', args: { path: 'a.txt', content: '2' } }] },
    { tools: [{ name: 'bash', args: { command: 'touch b.txt' } }] },
    { text: '写好了 a.txt，没有创建 b.txt。' },
  ], { mode: 'ask' })
  const done = host.execute({ type: 'send', text: '写文件' })
  const first = await approve(host, 'session')
  expect(first).toMatchObject({ toolName: 'write', rule: 'Edit(a.txt)' })
  const second = await approve(host, 'once', false)
  expect(second.toolName).toBe('bash')
  await done
  expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('2')
  expect(existsSync(join(workspace, 'b.txt'))).toBe(false)
  expect(host.snapshot().sessionRules).toEqual(['Edit(a.txt)'])
  await host.close()
})

it('plan mode refuses edits without asking; "always" rules persist per workspace', async () => {
  const { host, data, workspace } = await setup([
    { tools: [{ name: 'write', args: { path: 'plan.txt', content: 'x' } }] },
    { text: '规划模式下我不改文件，方案如下。' },
    { tools: [{ name: 'bash', args: { command: 'pnpm install left-pad' } }] },
    { text: '装好了。' },
  ], { mode: 'plan' })
  await host.execute({ type: 'send', text: '直接写' })
  expect(existsSync(join(workspace, 'plan.txt'))).toBe(false)
  expect(host.snapshot().approvals).toEqual([])
  await host.execute({ type: 'mode', mode: 'ask' })
  const done = host.execute({ type: 'send', text: '安装依赖' })
  await approve(host, 'always', false).catch(() => {})
  await done
  const settings = JSON.parse(await readFile(join(data, 'settings.json'), 'utf8'))
  expect(settings.workspaces[workspace].mode).toBe('ask')
  await host.close()
})

it('stopping a task is not an error: no red error, an interruption note, and the next task works', async () => {
  const { host } = await setup([
    { text: '第一轮。' },
    { text: '这一句会被打断', wait: 4000 },
    { text: '第三轮正常。' },
  ])
  await host.execute({ type: 'send', text: '你好' })
  const running = host.execute({ type: 'send', text: '慢慢想' })
  await vi.waitUntil(() => host.snapshot().state === 'running', { timeout: 3000, interval: 10 })
  await new Promise(r => setTimeout(r, 300))
  await host.execute({ type: 'stop' })
  await running
  const snapshot = host.snapshot()
  expect(snapshot.error).toBeUndefined()
  expect(snapshot.result?.status).toBe('aborted')
  expect(snapshot.messages!.at(-1)).toMatchObject({ note: true })
  expect(snapshot.messages!.filter(message => message.text === '第一轮。')).toHaveLength(1)
  await host.execute({ type: 'send', text: '继续' })
  expect(host.snapshot().messages!.at(-1)).toMatchObject({ role: 'assistant', text: '第三轮正常。' })
  await host.close()
}, 15000)

it('history comes from the kernel session and survives a restart, with origins', async () => {
  const { host } = await setup([{ text: '记住了。' }, { text: '还记得。' }])
  await host.submit('来自微信的消息', 'weixin')
  await host.close()
  await host.execute({ type: 'connect' })
  const snapshot = host.snapshot()
  expect(snapshot.restored).toBe(true)
  expect(snapshot.messages).toEqual([{ role: 'user', text: '来自微信的消息', origin: 'weixin' }, { role: 'assistant', text: '记住了。', origin: 'weixin' }])
  await host.close()
})

it('untrusted folders and remote channels are clamped to ask', async () => {
  const { host, workspace } = await setup([
    { tools: [{ name: 'write', args: { path: 'w.txt', content: 'x' } }] },
    { text: '好的。' },
  ], { trusted: false })
  await host.execute({ type: 'workspace', path: workspace })
  expect(host.snapshot().workspace).toMatchObject({ trusted: false, known: false })
  expect(host.snapshot().state).toBe('stopped')
  await expect(host.execute({ type: 'mode', mode: 'auto' })).rejects.toThrow(/信任/)
  await host.execute({ type: 'trust', trusted: true })
  await host.execute({ type: 'mode', mode: 'auto' })
  expect(host.snapshot().mode).toBe('auto')
  expect(host.effectiveMode('weixin')).toBe('ask')
  const reply = host.submit('从微信写文件', 'weixin')
  const question = await approve(host)
  expect(question.origin).toBe('weixin')
  await reply
  await host.close()
})

it.skipIf(process.platform === 'win32' || process.env.CI_NO_SANDBOX === '1')('auto mode runs commands in the OS sandbox: workspace writes only, network via approval', async () => {
  const { CommandSandbox } = await import('../packages/permissions/sandbox')
  const status = await CommandSandbox.probe()
  if (!status.available)
    return
  const escape = join(tmpdir(), '..', `anna-escape-${Date.now()}.txt`)
  const data = await mkdtemp(join(tmpdir(), 'anna-sbx-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'hiyori', statusEnabled: false, memoryEnabled: false, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'auto', rules: { allow: [], ask: [], deny: [] } } } }))
  const backend = await scriptedBackend([
    { tools: [{ name: 'bash', args: { command: `echo inside > out.txt; echo outside > ${escape}; curl -sS -m 5 -o /dev/null https://example.com/ && echo NET-OK || echo NET-BLOCKED` } }] },
    { text: '做完了。' },
  ], data)
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, () => {}, { kernel: context => createPiKernel(context, backend) })
  await host.initialize()
  await host.execute({ type: 'connect' })
  // Systems that ship but forbid the sandbox (self-test failed) degrade to "no sandbox"; nothing to assert here.
  if (!host.snapshot().platform.sandbox.available)
    return host.close()
  const done = host.execute({ type: 'send', text: '跑命令' })
  const question = await approve(host, 'once', false)
  expect(question).toMatchObject({ toolName: 'network', details: 'example.com:443' })
  await done
  expect(await readFile(join(workspace, 'out.txt'), 'utf8')).toBe('inside\n')
  expect(existsSync(escape)).toBe(false)
  await host.close()
}, 30000)
