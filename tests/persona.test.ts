import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { characters } from '../packages/character/manifest'
import { defaultProfile, personalityCards, personalityInstructions } from '../packages/character/personality'

const persona = readFileSync('plugins/anna-persona/persona.md', 'utf8')

it('gives each personality card its own way of behaving, not just a label', () => {
  const texts = personalityCards.map(card => personalityInstructions({ ...defaultProfile(), type: card.id }).replace(/风格：.*\n/, ''))
  expect(new Set(texts).size).toBe(16)
  const entp = personalityInstructions({ ...defaultProfile(), type: 'ENTP' })
  expect(entp).toMatch(/主动/)
  expect(entp).toMatch(/可能/)
  expect(entp).toMatch(/直接/)
  expect(entp).toMatch(/先试/)
  const isfj = personalityInstructions({ ...defaultProfile(), type: 'ISFJ' })
  expect(isfj).toMatch(/先听/)
  expect(isfj).toMatch(/感受/)
  expect(isfj).toMatch(/步骤/)
})

it('describes the user\'s preferences in words the model can use', () => {
  const text = personalityInstructions({ ...defaultProfile(), purpose: 'company', detail: 'brief', advice: 'direct' })
  expect(text).toContain('聊天与日常陪伴')
  expect(text).toContain('简短')
  expect(text).toContain('坦率')
  expect(text).not.toMatch(/用途：company|篇幅：brief/)
})

it('keeps the boundaries while giving Anna a distinct voice', () => {
  for (const rule of ['不编造', '尊重用户的最终决定', '遵守权限'])
    expect(persona).toContain(rule)
  expect(persona).toMatch(/作为.{0,3}AI/)
  expect(persona).toMatch(/好奇/)
  expect(characters[0].persona.length).toBeGreaterThan(80)
})
