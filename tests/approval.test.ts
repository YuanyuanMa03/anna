import { expect, it } from 'vitest'
import { ApprovalBroker } from '../packages/anna-host/approval-broker'

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
