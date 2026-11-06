import type { BenchmarkCase } from '../packages/evaluation/execution'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { checkCase, PiMeasurements, prepareCase } from '../packages/evaluation/execution'
import { runPiCase } from '../packages/evaluation/pi-run'
import cases from './fixtures/life-benchmark/cases.json'

async function workspace(id: string) {
  const data = await mkdtemp(join(tmpdir(), 'anna-benchmark-'))
  const directory = join(data, 'workspace')
  const item = (cases as unknown as BenchmarkCase[]).find(item => item.id === id)!
  await prepareCase(item, directory)
  return { data, directory, item }
}
it('preserves fixture inputs, refuses reused directories and checks required facts', async () => {
  const { directory, item } = await workspace('F01')
  await expect(prepareCase(item, directory)).rejects.toThrow()
  await writeFile(join(directory, 'overview.md'), 'notes.txt budget.csv draft/article.md')
  expect((await checkCase(item, directory)).success).toBe(true)
  await writeFile(join(directory, 'notes.txt'), 'changed')
  expect((await checkCase(item, directory)).failures).toContain('源文件被修改或丢失：notes.txt')
})
it('requires two preserved copies and accepts unordered duplicate groups', async () => {
  const { directory, item } = await workspace('F02')
  await mkdir(join(directory, 'organized'))
  await writeFile(join(directory, 'result.md'), '两份报告')
  await writeFile(join(directory, 'organized/a.txt'), 'alpha report\n')
  expect((await checkCase(item, directory)).success).toBe(false)
  await writeFile(join(directory, 'organized/b.txt'), 'beta report\n')
  expect((await checkCase(item, directory)).success).toBe(true)
  const duplicates = await workspace('F03')
  await writeFile(join(duplicates.directory, 'duplicates.json'), '[["nested/c.txt","a.txt"]]')
  expect((await checkCase(duplicates.item, duplicates.directory)).success).toBe(true)
})
it('runs original code tests and refuses to accept changed tests', async () => {
  const { directory, item } = await workspace('C03')
  expect((await checkCase(item, directory)).success).toBe(false)
  await writeFile(join(directory, 'total.mjs'), 'export function total(items) { return items.reduce((sum, item) => sum + item.price * (item.quantity ?? 1), 0); }')
  expect((await checkCase(item, directory)).success).toBe(true)
  await writeFile(join(directory, 'total.test.mjs'), 'throw new Error("must not execute modified tests");')
  const result = await checkCase(item, directory)
  expect(result.success).toBe(false)
  expect(result.verification).toBeUndefined()
})
it('aggregates raw baseline SDK events without duplicating or estimating usage', () => {
  const measurement = new PiMeasurements()
  const message = { role: 'assistant', usage: { totalTokens: 10, input: 4, output: 3, cacheRead: 2, cacheWrite: 1 } }
  measurement.message(message)
  measurement.message(message)
  expect(measurement.usage).toEqual({ input: 4, output: 3, cacheRead: 2, cacheWrite: 1, partial: false })
  measurement.message({ role: 'assistant', usage: { totalTokens: 0 } })
  expect(measurement.usage?.partial).toBe(true)
})
it('executes an isolated actual Host loop with a scripted SDK fixture and never stores its credential', async () => {
  const { data, directory, item } = await workspace('F01')
  const script = join(data, 'script.json')
  await writeFile(script, JSON.stringify([{ tools: [{ name: 'write', args: { path: 'overview.md', content: 'notes.txt budget.csv draft/article.md' } }] }, { text: '完成盘点。' }]))
  vi.stubEnv('ANNA_TEST_SCRIPT', script)
  try {
    const result = await runPiCase(resolve('.'), item, directory, join(data, 'host'), { provider: 'custom', model: 'fixture', api: 'openai-completions', baseURL: 'https://fixture.invalid' }, 'fixture-secret')
    expect(result.success).toBe(true)
    expect(result.actualModel).toBe('scripted')
    expect(result.answer).toContain('完成盘点')
    expect(await readFile(join(data, 'host/settings.json'), 'utf8')).not.toContain('fixture-secret')
  }
  finally { vi.unstubAllEnvs() }
}, 20_000)
