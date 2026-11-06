import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

it('provides twelve fixed tasks, three per work method, with concrete inputs and acceptance evidence', async () => {
  const cases = JSON.parse(await readFile('tests/fixtures/life-benchmark/cases.json', 'utf8'))
  expect(cases).toHaveLength(12)
  expect(new Set(cases.map((item: { id: string }) => item.id)).size).toBe(12)
  for (const category of ['files', 'text', 'project', 'code'])
    expect(cases.filter((item: { category: string }) => item.category === category)).toHaveLength(3)
  for (const item of cases) {
    expect(Object.keys(item.files).length).toBeGreaterThan(0)
    expect(item.requiredFiles.length).toBeGreaterThan(0)
    expect(item.rubric).toHaveLength(4)
    if (item.category === 'code') {
      expect(item.testCommand).toBe('node --test')
      expect(Object.keys(item.files).some(file => file.endsWith('.test.mjs'))).toBe(true)
    }
  }
})
