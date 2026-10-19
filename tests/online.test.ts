import { describe, expect, it } from 'vitest'
import { shortPaths } from '../apps/desktop/src/online'

/** The online demo shows the visitor's workspace as `workspace`, not the server's 100-character path. */
describe('short paths in the online demo', () => {
  const root = '/tmp/anna-web-sessions/7b13b4b4b1e3e5c1400cbb23b4e68c387689aeef4a0cd1666d2d6dd96d636aa/workspace'

  it('approval cards, activity rows and replies show `workspace`', () => {
    const snapshot = {
      approvals: [{ id: 'a', details: `cd ${root} && git diff src/cli.js` }],
      activity: [{ tool: 'edit', target: `${root}/src/planner.js` }],
      messages: [{ role: 'assistant', text: `现在的工作区：\`/private${root}\`` }],
    }
    expect(shortPaths(snapshot, root)).toEqual({
      approvals: [{ id: 'a', details: 'cd workspace && git diff src/cli.js' }],
      activity: [{ tool: 'edit', target: 'workspace/src/planner.js' }],
      messages: [{ role: 'assistant', text: '现在的工作区：`workspace`' }],
    })
  })

  it('leaves a longer folder name, numbers and permission rules alone', () => {
    const snapshot = { note: `${root}-old/a.txt`, steps: 3, ok: true, workspace: { rules: { allow: [`Bash(cat ${root}/a.txt)`] } } }
    expect(shortPaths(snapshot, root)).toEqual(snapshot)
  })
})
