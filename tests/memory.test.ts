import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
