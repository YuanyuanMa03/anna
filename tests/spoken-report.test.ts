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
  const text = spokenReport('看完了，记忆模块主要差三点：没有按日期查、没有导出、长期不用的记忆不会淡化。\n\n- 按日期查：`memory.ts` 里只有按分类的筛选\n- 导出：没有任何导出入口\n- 淡化：记忆没有最后使用时间', result({ commands: 3, files: ['memory.ts'] }))
  expect(text).toContain('看完了，记忆模块主要差三点')
  expect(text).toContain('细节在屏幕上')
})

it('asks for an approval in one short line', () => {
  expect(spokenApproval({ toolName: 'bash', reason: '这条命令可能造成难以撤销的影响', details: `rm -rf build && echo done && ${'x'.repeat(200)}`, danger: true })).toMatch(/^这一步有风险/)
  expect(Array.from(spokenApproval({ toolName: 'bash', reason: '运行命令', details: 'x'.repeat(300), danger: false })).length).toBeLessThanOrEqual(80)
})

it('keeps ordinary text with slashes and numbers, and drops whole links', () => {
  expect(spokenReport('比例是 1/2，日期 11/06，TCP/IP 和/或 v1/v2 都行。', result())).toBe('比例是 1/2，日期 11/06，TCP/IP 和/或 v1/v2 都行。')
  expect(spokenReport('文档在 https://example.com/a/b 里。', result())).toBe('文档在里。细节在屏幕上。')
})

it('separates her words from the numbers, and says details are on screen only when there are more', () => {
  expect(spokenReport('好的，已经修复', result({ changes: [{ path: 'a.ts', status: 'modified', added: 1, removed: 0 }] }))).toBe('好的，已经修复。改了 1 个文件。细节在屏幕上。')
  expect(spokenReport('今天天气不错。', result({ files: ['a.txt'], commands: 1 }))).toBe('今天天气不错。')
  expect(spokenReport('```ts\nconst a = 1\n```', result())).toBe('好了，细节在屏幕上。')
})

it('does not lose a long answer to a short first sentence, and cuts English at a word', () => {
  const text = spokenReport(`当然可以！Vue 的响应式系统会在你修改数据时自动追踪依赖，${'并且在下一次渲染时只更新真正变化的部分，'.repeat(3)}所以很高效。`, result())
  expect(text.startsWith('当然可以！Vue 的响应式系统')).toBe(true)
  expect(Array.from(text).length).toBeLessThanOrEqual(90)
  const english = spokenReport(`Sure. ${'The parser handles empty input and trailing commas gracefully, '.repeat(3)}done.`, result())
  expect(english).toMatch(/^Sure\./)
  expect(english).not.toMatch(/\b\w{1,3}…$/)
})

it('asks for any approval with the reason as written, and names only what can be said', () => {
  expect(spokenApproval({ toolName: 'edit', reason: '修改文件', details: '/Users/me/project/src/memory.ts', danger: false })).toBe('需要你确认：修改文件 memory.ts。')
  expect(spokenApproval({ toolName: 'bash', reason: '运行命令', details: 'pnpm test --filter @anna/host', danger: false })).toBe('需要你确认：运行命令 pnpm test。')
  expect(spokenApproval({ toolName: 'read', reason: '你的规则要求读取这里之前先确认', details: '', danger: false })).toBe('需要你确认：你的规则要求读取这里之前先确认。')
})
