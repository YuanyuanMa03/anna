import { expect, it } from 'vitest'
import { firstTasks } from '../packages/character/first-tasks'

it('offers three tasks grounded in visible files and project metadata', () => {
  const tasks = firstTasks(['.env', 'README.md', 'package.json'], true)
  expect(tasks).toHaveLength(3)
  expect(tasks[1]).toContain('README.md')
  expect(tasks[2]).toContain('入口文件')
  expect(tasks.join('')).not.toContain('.env')
})

it('keeps first tasks read-only for an untrusted empty directory', () => {
  const tasks = firstTasks([], false)
  expect(tasks).toHaveLength(3)
  expect(tasks[2]).toContain('不运行命令、不修改文件')
})
