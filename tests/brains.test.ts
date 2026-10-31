import { describe, expect, it } from 'vitest'
import { brainChoices, recommendedBrain } from '../packages/agents/brains'
import { autoInstallable, catalog } from '../packages/agents/catalog'

describe('install commands', () => {
  it('runs only plain global npm installs itself, and every agent she can delegate to has one', () => {
    expect(autoInstallable('npm i -g @deepseek-ai/dsh@latest --engine-strict')).toBe(true)
    expect(autoInstallable('curl -fsSL https://antigravity.google/cli/install.sh | bash')).toBe(false)
    expect(autoInstallable('bun install -g @oh-my-pi/pi-coding-agent@latest')).toBe(false)
    expect(autoInstallable('npm i -g x; rm -rf ~')).toBe(false)
    for (const agent of catalog.filter(item => item.tier === 'delegate'))
      expect(autoInstallable(agent.install!), agent.id).toBe(true)
  })
})

const claude = { id: 'claude', installed: true, version: '2.1.302', loggedIn: true }
const codex = { id: 'codex', installed: true, version: '0.160.0', loggedIn: false }

describe('brain choices', () => {
  it('lists pi first, then every agent that can think for her, with its state', () => {
    const choices = brainChoices({ detected: [claude, codex], current: 'pi', hasKey: true })
    expect(choices.map(choice => choice.id)).toEqual(['pi', 'claude-code', 'codex'])
    expect(choices[0]).toMatchObject({ state: 'ready', current: true })
    expect(choices[1]).toMatchObject({ state: 'ready', current: false, note: 'v2.1.302' })
    expect(choices[2]).toMatchObject({ state: 'signed-out', note: 'v0.160.0 · 未登录' })
  })
  it('says pi needs a model and an absent agent is not installed', () => {
    const choices = brainChoices({ detected: [], current: 'pi', hasKey: false })
    expect(choices.find(choice => choice.id === 'pi')).toMatchObject({ state: 'needs-key' })
    expect(choices.find(choice => choice.id === 'claude-code')).toMatchObject({ state: 'missing', note: '未安装' })
  })
  it('treats an agent whose login it cannot check as ready', () => {
    const choices = brainChoices({ detected: [{ id: 'claude', installed: true, version: '2.0.0' }], current: 'claude-code', hasKey: false })
    expect(choices.find(choice => choice.id === 'claude-code')).toMatchObject({ state: 'ready', current: true })
  })
})

describe('recommended brain', () => {
  it('offers a newcomer without a model the first signed-in agent', () => {
    expect(recommendedBrain(brainChoices({ detected: [codex, claude], current: 'pi', hasKey: false }))?.id).toBe('claude-code')
  })
  it('recommends nothing when pi already thinks or no agent is ready', () => {
    expect(recommendedBrain(brainChoices({ detected: [claude], current: 'pi', hasKey: true }))).toBeUndefined()
    expect(recommendedBrain(brainChoices({ detected: [codex], current: 'pi', hasKey: false }))).toBeUndefined()
  })
})
