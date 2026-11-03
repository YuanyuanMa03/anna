import { expect, it } from 'vitest'
import { catalog } from '../packages/agents/catalog'
import { installationGuide } from '../packages/agents/installation'

it('shows platform-specific commands for supported installation guides', () => {
  for (const id of ['claude', 'qoder-cn', 'trae']) {
    const agent = catalog.find(item => item.id === id)!
    expect(installationGuide(agent, 'win32').command).toContain('.ps1')
    expect(installationGuide(agent, 'darwin').command).toContain('.sh')
    expect(installationGuide(agent, 'linux').command).toContain('.sh')
  }
})

it('keeps shell-only installers out of Windows instructions and offers a source link', () => {
  const agent = catalog.find(item => item.id === 'omp')!
  expect(installationGuide(agent, 'win32').command).toBeUndefined()
  expect(installationGuide(agent, 'win32').url).toMatch(/^https:/)
})

it('documents installation for every card and never asks users to install the embedded pi framework', () => {
  for (const agent of catalog.filter(agent => agent.id !== 'pi'))
    expect(installationGuide(agent, 'win32').url).toMatch(/^https:/)
  expect(installationGuide(catalog.find(agent => agent.id === 'codex')!, 'win32').needsNode).toBe(true)
})
