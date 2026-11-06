import type { TaskResult } from '../packages/shared/contracts'
import { expect, it } from 'vitest'
import { spokenApproval, spokenReport } from '../packages/voice/report'

const result = (over: Partial<TaskResult> = {}): TaskResult => ({ taskId: 't', status: 'completed', ok: true, files: [], changes: [], commands: 0, failedTools: 0, summary: '', origin: 'desktop', ...over })

it('says a chat reply as it is, but short', () => {
  expect(spokenReport('好呀，今天想聊点什么？我在这儿。', result())).toBe('好呀，今天想聊点什么？我在这儿。')
  const long = `${'这是一句很长的话，'.repeat(12)}结束。第二句。第三句。`
  expect(Array.from(spokenReport(long, result())).length).toBeLessThanOrEqual(90)
})

it('reports finished work from the real numbers, not by reading the reply aloud', () => {
  const reply = '改好了。\n\n```ts\nconst a = 1\n```\n- packages/anna-host/memory.ts：加了按日期筛选\n- tests/memory.test.ts：补了测试'
  const text = spokenReport(reply, result({ changes: [{ path: 'a.ts', status: 'modified', added: 3, removed: 1 }, { path: 'b.ts', status: 'added', added: 9, removed: 0 }], commands: 2, tests: 'passed' }))
  expect(text).toMatch(/^改好了/)
  expect(text).toContain('改了 2 个文件')
  expect(text).toContain('测试都过了')
  expect(text).toContain('细节在屏幕上')
  expect(text).not.toMatch(/const|packages\/|\.ts/)
})

it('says plainly when tests fail or the task did not finish', () => {
  expect(spokenReport('我改了一处，但测试没过。', result({ changes: [{ path: 'a.ts', status: 'modified', added: 1, removed: 1 }], tests: 'failed' }))).toContain('有测试没过')
  expect(spokenReport('', result({ status: 'failed', ok: false }))).toMatch(/没做完/)
  expect(spokenReport('', result({ status: 'aborted', ok: false }))).toMatch(/停下了/)
})

it('reports work that only looked at things', () => {
  const text = spokenReport('看完了，记忆模块主要差三点：没有按日期查、没有导出、长期不用的记忆不会淡化。具体见下面。', result({ commands: 3, files: ['memory.ts'] }))
  expect(text).toContain('看完了，记忆模块主要差三点')
  expect(text).toContain('细节在屏幕上')
})

it('asks for an approval in one short line', () => {
  expect(spokenApproval({ toolName: 'edit', reason: '修改文件', details: 'tasks.txt', danger: false })).toBe('我想修改文件：tasks.txt。可以的话点一下“允许”。')
  expect(spokenApproval({ toolName: 'bash', reason: '这条命令可能造成难以撤销的影响', details: `rm -rf build && echo done && ${'x'.repeat(200)}`, danger: true })).toMatch(/^这一步有风险/)
  expect(Array.from(spokenApproval({ toolName: 'bash', reason: '运行命令', details: 'x'.repeat(300), danger: false })).length).toBeLessThanOrEqual(80)
})
