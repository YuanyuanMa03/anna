import type { AgentKernel, KernelContext } from '../packages/kernels/types'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { Host } from '../packages/anna-host/host'

/** A kernel that records what the host tells it, and can call the tools it was given. */
function recordingKernel(log: { notes: string[], prompts: string[], contexts: KernelContext[] }, turn?: (context: KernelContext) => Promise<void>) {
  return (context: KernelContext): AgentKernel => {
    log.contexts.push(context)
    return {
      capabilities: { id: 'pi', label: 'recording', steering: false, sessions: false, shell: 'bash' },
      sessionId: 'recording',
      restored: false,
      tools: [],
      plugins: [],
      start: async () => {},
      prompt: async (text: string) => {
        log.prompts.push(text)
        await turn?.(context)
        return { status: 'completed', text: '好。' }
      },
      steer: async () => {},
      note: (text: string) => { log.notes.push(text) },
      remember: () => {},
      abort: async () => {},
      close: async () => {},
      history: () => [],
    }
  }
}

async function setup(options: { kernel?: string, characterId?: string, turn?: (context: KernelContext) => Promise<void>, notes?: string } = {}) {
  const data = await mkdtemp(join(tmpdir(), 'anna-host-memory-'))
  const workspace = join(data, 'project')
  await mkdir(workspace)
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: options.kernel ?? 'pi', characterId: options.characterId ?? 'haru', statusEnabled: false, memoryEnabled: true, model: { provider: 'custom', model: 'x', baseURL: 'https://x.invalid', api: 'openai-completions' }, workspace, workspaces: { [workspace]: { trusted: true, mode: 'edit', rules: { allow: [], ask: [], deny: [] } } } }))
  const log = { notes: [] as string[], prompts: [] as string[], contexts: [] as KernelContext[] }
  const host = new Host(resolve('.'), data, { read: async () => 'key', write: async () => {} }, () => {}, { sandbox: { available: false, reason: 'test' }, kernel: recordingKernel(log, options.turn), ...(options.notes ? { notes: options.notes } : {}) })
  await host.initialize()
  return { host, log, workspace }
}

it('"记住：…" is kept for sure, signed by the companion on stage, and the brain is told it is already kept', async () => {
  const { host, log } = await setup({ characterId: 'chitose' })
  await host.execute({ type: 'send', text: '记住：我每周三下午有实验课' })
  expect(host.snapshot().memories.map(item => [item.text, item.by])).toEqual([['我每周三下午有实验课', '千岁']])
  expect(log.notes.join('\n')).toContain('已经记进共同记忆')
  expect(log.notes.join('\n')).toContain('我每周三下午有实验课')
  await host.close()
})

it('a line a Claude Code brain stores through anna_memory names the companion and the brain', async () => {
  const { host } = await setup({
    kernel: 'claude-code',
    turn: async (context) => { await context.tools.find(tool => tool.name === 'anna_memory')!.execute({ action: 'remember', text: '复习时喜欢番茄钟' }) },
  })
  await host.execute({ type: 'send', text: '我复习时喜欢用番茄钟' })
  expect(host.snapshot().memories.map(item => [item.text, item.by])).toEqual([['复习时喜欢番茄钟', 'Anna（Claude Code）']])
  await host.close()
})

it('asking whether something was remembered stores nothing', async () => {
  const { host, log } = await setup()
  for (const text of ['记住了吗？', '你记住我说的了吗', '记住'])
    await host.execute({ type: 'send', text })
  expect(host.snapshot().memories).toEqual([])
  expect(log.notes.join('\n')).not.toContain('已经记进共同记忆')
  await host.close()
})

it('an edition\'s notes reach the brain with the rest of the instructions', async () => {
  const { host, log } = await setup({ notes: '## 在线体验版\n这里没有微信。' })
  await host.execute({ type: 'send', text: '你好' })
  expect(log.contexts.at(-1)!.instructions.join('\n')).toContain('## 在线体验版\n这里没有微信。')
  await host.close()
})

it('the brain is told today\'s date and weekday, so it never guesses which day a date falls on', async () => {
  const { host, log } = await setup()
  await host.execute({ type: 'send', text: '这周三是几号？' })
  const today = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
  expect(log.notes.join('\n')).toContain(`今天是 ${today}`)
  await host.close()
})
