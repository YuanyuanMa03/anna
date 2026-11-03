import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MemoryStore } from '../packages/anna-host/memory'

/** The shared diary says who wrote each line, so a companion can say whose it was. */
describe('the shared diary', () => {
  it('keeps who wrote each line, and the instructions say so', async () => {
    const store = new MemoryStore(await mkdtemp(join(tmpdir(), 'anna-memory-')))
    await store.load()
    await store.remember('用户每周三下午有实验课', 'Anna')
    await store.remember('复习时喜欢番茄钟', '千岁（Claude Code）')
    expect(store.items.map(item => item.by)).toEqual(['Anna', '千岁（Claude Code）'])
    expect(store.instructions()).toContain('- 用户每周三下午有实验课（Anna 记下）')
    expect(store.instructions()).toContain('- 复习时喜欢番茄钟（千岁（Claude Code） 记下）')
  })

  it('a line from before writers were kept says so instead of guessing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anna-memory-'))
    await writeFile(join(dir, 'memory.json'), JSON.stringify([{ id: 'old', text: '喜欢绿茶', createdAt: '2026-10-01T00:00:00.000Z' }]))
    const store = new MemoryStore(dir)
    await store.load()
    expect(store.instructions()).toContain('- 喜欢绿茶（没记录是谁记的）')
  })

  it('what a brain stores through anna_memory is signed by whoever is on stage', async () => {
    const store = new MemoryStore(await mkdtemp(join(tmpdir(), 'anna-memory-')))
    await store.load()
    let onStage = 'Mao'
    const tool = store.tool(() => {}, () => onStage)
    await tool.execute({ action: 'remember', text: '周五晚上不安排复习' })
    onStage = '马克君（Codex）'
    await tool.execute({ action: 'remember', text: '早上八点前别打扰' })
    expect(store.items.map(item => [item.text, item.by])).toEqual([['周五晚上不安排复习', 'Mao'], ['早上八点前别打扰', '马克君（Codex）']])
  })

  it('a line that looks like a credential is never stored, whoever asks', async () => {
    const store = new MemoryStore(await mkdtemp(join(tmpdir(), 'anna-memory-')))
    await store.load()
    expect(await store.remember('我的密码是 hunter2', 'Anna')).toBeUndefined()
    expect(await store.remember('key: sk-abcdef', 'Anna')).toBeUndefined()
    expect(store.items).toEqual([])
  })
})

it('stores the edited candidate and category rather than the original proposal', async () => {
  const store = new MemoryStore(await mkdtemp(join(tmpdir(), 'anna-memory-edit-')))
  await store.load()
  const confirm = vi.fn(async () => ({ text: '我们约好先给结论', kind: 'agreement' as const }))
  await store.tool(() => {}, () => 'Anna', confirm).execute({ action: 'remember', text: '用户喜欢详细解释' })
  expect(store.items[0]).toMatchObject({ text: '我们约好先给结论', kind: 'agreement', by: 'Anna' })
})

it('does not repeat a dismissed proposal after restart, and never proposes credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anna-memory-dismiss-'))
  const first = new MemoryStore(directory)
  await first.load()
  const confirm = vi.fn(async () => false as const)
  await first.tool(() => {}, () => 'Anna', confirm).execute({ action: 'remember', text: '喜欢绿茶' })
  const restored = new MemoryStore(directory)
  await restored.load()
  const tool = restored.tool(() => {}, () => 'Anna', confirm)
  await tool.execute({ action: 'remember', text: '喜欢绿茶' })
  await tool.execute({ action: 'remember', text: '密码是 hunter2' })
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(restored.items).toEqual([])
  await restored.remember('喜欢绿茶', 'Anna')
  expect(restored.items).toHaveLength(1)
})

it('recognizes explicit natural-language requests without saving questions or acknowledgements', async () => {
  const { explicitMemory } = await import('../packages/anna-host/memory')
  expect(explicitMemory('请记住我喜欢短一点的回答')).toBe('我喜欢短一点的回答')
  expect(explicitMemory('帮我记住我们周五复盘')).toBe('我们周五复盘')
  for (const text of ['记住了吗？', '记住我说的了吗', '记住了，谢谢', '记住没有', '记住'])
    expect(explicitMemory(text)).toBeUndefined()
})
