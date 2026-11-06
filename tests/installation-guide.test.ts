import { expect, it } from 'vitest'
import { catalog } from '../packages/agents/catalog'
import { installationGuide, installSteps } from '../packages/agents/installation'

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

it('walks a non-technical user through every agent, step by step, on a Mac and on Windows', () => {
  for (const agent of catalog.filter(agent => agent.id !== 'pi')) {
    for (const platform of ['darwin', 'win32'] as const) {
      const guide = installSteps(agent, platform)
      expect(guide.steps.length, `${agent.id} ${platform}`).toBeGreaterThanOrEqual(2)
      expect(guide.steps.at(-1), agent.id).toMatch(/重新检测/)
      expect(guide.after, agent.id).toBeTruthy()
      if (guide.scriptOnly) {
        // Never send a Windows user to a page of shell script.
        expect(guide.steps[0], agent.id).toMatch(/Windows 上暂时装不了/)
        expect(guide.url, agent.id).toBeUndefined()
        continue
      }
      if (guide.command) {
        expect(guide.steps.some(step => (platform === 'win32' ? /打开“Windows PowerShell”/ : /打开“终端”/).test(step)), agent.id).toBe(true)
        if (platform === 'win32')
          expect(guide.command, agent.id).not.toMatch(/\b(?:curl|bash|sh)\b/)
      }
      else {
        expect(guide.url, agent.id).toMatch(/^https:/)
      }
      if (platform === 'win32' && guide.command?.includes(' i -g '))
        expect(guide.command, agent.id).toMatch(/^npm\.cmd /)
      if (guide.oneClick)
        expect(guide.command?.replace(/^npm\.cmd /, 'npm '), agent.id).toBe(agent.install)
    }
  }
})

it('tells Claude Code and Codex users they can use a vendor key instead of an official login', () => {
  for (const id of ['claude', 'codex'])
    expect(installSteps(catalog.find(agent => agent.id === id)!, 'win32').after).toMatch(/API Key/)
})

it('offers one click only where it runs the very command the card shows', () => {
  const pick = (id: string) => catalog.find(agent => agent.id === id)!
  expect(installSteps(pick('codex'), 'win32').oneClick).toBe(true)
  // Claude Code's guide shows its native installer; the npm build would be a different install.
  expect(installSteps(pick('claude'), 'darwin').oneClick).toBe(false)
  expect(installSteps(pick('trae'), 'win32').oneClick).toBe(false)
})

it('does not promise more than Anna can do with an agent', () => {
  const pick = (id: string) => catalog.find(agent => agent.id === id)!
  expect(installSteps(pick('workbuddy'), 'darwin').after).toMatch(/只能检测到/)
  expect(installSteps(pick('gemini'), 'darwin').after).toMatch(/@gemini/)
  expect(installSteps(pick('cursor'), 'win32').scriptOnly).toBe(true)
  expect(installSteps(pick('claude'), 'win32').steps.join('')).toMatch(/Git for Windows/)
})
