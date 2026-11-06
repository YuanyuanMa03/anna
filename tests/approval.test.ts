import { expect, it } from 'vitest'
import { ApprovalBroker } from '../packages/anna-host/approval-broker'
import { approvalRules } from '../packages/shared/approval-rules'

const base = { toolName: 'bash', reason: 'synthetic approval test', details: 'pnpm install', rule: 'Bash(pnpm install:*)', danger: false, origin: 'desktop' as const }

it('waits for a decision and only widens scope for safe calls with a rule', async () => {
  const seen: string[] = []
  const broker = new ApprovalBroker((question) => {
    if (question)
      seen.push(question.details)
  })
  const session = broker.ask(base)
  expect(seen).toEqual(['pnpm install'])
  broker.decide(broker.questions[0]!.id, true, 'session')
  expect(await session).toBe('allowed-session')

  const always = broker.ask(base)
  broker.decide(broker.questions[0]!.id, true, 'always')
  expect(await always).toBe('allowed-always')

  const risky = broker.ask({ ...base, danger: true, rule: undefined, details: 'rm -rf build' })
  broker.decide(broker.questions[0]!.id, true, 'always')
  expect(await risky).toBe('allowed-once')

  const rejected = broker.ask(base)
  broker.decide(broker.questions[0]!.id, false)
  expect(await rejected).toBe('rejected')
  expect(() => broker.decide('missing', true)).toThrow()

  const pending = broker.ask(base)
  broker.cancel()
  expect(await pending).toBe('cancelled')
  expect(broker.questions).toEqual([])
})

it('remembers every safe compound command rule for session and permanent approval', async () => {
  for (const scope of ['session', 'always'] as const) {
    const broker = new ApprovalBroker(() => {})
    const pending = broker.ask({ ...base, rule: undefined, rules: ['Bash(pnpm install *)', 'Bash(pnpm test *)'], details: 'pnpm install && pnpm test' })
    broker.decide(broker.questions[0]!.id, true, scope)
    expect(await pending).toBe(scope === 'always' ? 'allowed-always' : 'allowed-session')
  }
})

it('never widens dangerous, missing or incomplete compound rules', async () => {
  for (const scope of ['session', 'always'] as const) {
    for (const question of [
      { ...base, rule: undefined, rules: [] },
      { ...base, rules: [] },
      { ...base, rule: undefined, rules: [''] },
      { ...base, rule: undefined, rules: ['  '] },
      { ...base, rule: undefined, rules: ['Bash(pnpm test *)', ''] },
      { ...base, rule: '  ' },
      { ...base, danger: true, rules: ['Bash(pnpm install *)', 'Bash(pnpm test *)'] },
    ]) {
      const broker = new ApprovalBroker(() => {})
      const pending = broker.ask(question)
      broker.decide(broker.questions[0]!.id, true, scope)
      expect(await pending).toBe('allowed-once')
    }
  }
})

it('retains legacy rules when plural rules are absent', async () => {
  const broker = new ApprovalBroker(() => {})
  const pending = broker.ask(base)
  broker.decide(broker.questions[0]!.id, true, 'always')
  expect(await pending).toBe('allowed-always')
})

it('keeps memory confirmation one-time even when a rule is supplied', async () => {
  const broker = new ApprovalBroker(() => {})
  const pending = broker.ask({ ...base, memory: { text: 'Synthetic preference', kind: 'preference' } })
  broker.decide(broker.questions[0]!.id, true, 'always')
  expect(await pending).toBe('allowed-once')
})

it('uses the same complete, deduplicated rule set for display and persistence', () => {
  expect(approvalRules({ ...base, rules: [' Bash(pnpm install *) ', 'Bash(pnpm test *)', 'Bash(pnpm install *)'] })).toEqual(['Bash(pnpm install *)', 'Bash(pnpm test *)'])
  expect(approvalRules({ ...base, rules: [] })).toEqual([])
  expect(approvalRules({ ...base, rules: ['Bash(pnpm test *)', ' '] })).toEqual([])
  expect(approvalRules(base)).toEqual([base.rule])
})
