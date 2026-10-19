import { describe, expect, it } from 'vitest'
import { shortPaths, tourPrompts } from '../apps/desktop/src/online'
import { explicitMemory } from '../packages/anna-host/memory'

/** The online demo shows the visitor's workspace as 〈工作区〉, not the server's 100-character path. */
describe('short paths in the online demo', () => {
  const root = '/tmp/anna-web-sessions/7b13b4b4b1e3e5c1400cbb23b4e68c387689aeef4a0cd1666d2d6dd96d636aa/workspace'

  it('approval cards, activity rows and replies show 〈工作区〉', () => {
    const snapshot = {
      approvals: [{ id: 'a', details: `cd ${root} && git diff src/cli.js` }],
      activity: [{ tool: 'edit', target: `${root}/src/planner.js` }],
      messages: [{ role: 'assistant', text: `现在的工作区：\`/private${root}\`` }],
    }
    expect(shortPaths(snapshot, root)).toEqual({
      approvals: [{ id: 'a', details: 'cd 〈工作区〉 && git diff src/cli.js' }],
      activity: [{ tool: 'edit', target: '〈工作区〉/src/planner.js' }],
      messages: [{ role: 'assistant', text: '现在的工作区：`〈工作区〉`' }],
    })
  })

  it('leaves a longer folder name, a path that only ends the same way, and numbers alone', () => {
    const snapshot = { note: `${root}-old/a.txt`, other: `/x${root}/a.txt`, steps: 3, ok: true }
    expect(shortPaths(snapshot, root)).toEqual(snapshot)
  })

  it('never rewrites a permission rule, so removing one names it exactly', () => {
    const rule = `Bash(cat ${root}/a.txt)`
    const snapshot = { workspace: { rules: { allow: [rule] } }, sessionRules: [rule], approvals: [{ id: 'a', details: `cat ${root}/a.txt`, rule }] }
    expect(shortPaths(snapshot, root)).toEqual({ workspace: { rules: { allow: [rule] } }, sessionRules: [rule], approvals: [{ id: 'a', details: 'cat 〈工作区〉/a.txt', rule }] })
  })

  it('keeps deleting the whole workspace distinct from deleting a folder named workspace', () => {
    expect(shortPaths(`rm -rf ${root}`, root)).not.toBe(shortPaths('rm -rf workspace', root))
  })
})

describe('the tour', () => {
  it('its memory prompt is one Anna keeps for sure, not left to the model', () => {
    const remembered = tourPrompts().map(prompt => explicitMemory(prompt)).filter(Boolean)
    expect(remembered).toEqual(['我每周三下午有实验课，复习时喜欢番茄钟'])
  })
})
