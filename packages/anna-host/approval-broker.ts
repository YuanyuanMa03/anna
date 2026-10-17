import type { ApprovalOutcome, ApprovalQuestion, ApprovalScope } from '../shared/contracts'
import { randomUUID } from 'node:crypto'

/** Decisions for tool calls the policy escalates. A question waits until someone answers or the task is cancelled. */
export class ApprovalBroker {
  private pending = new Map<string, { question: ApprovalQuestion, settle: (outcome: ApprovalOutcome) => void }>()
  constructor(private changed: (question?: ApprovalQuestion) => void) {}
  get questions() { return [...this.pending.values()].map(item => item.question) }

  ask(question: Omit<ApprovalQuestion, 'id'>) {
    return new Promise<ApprovalOutcome>((resolve) => {
      const id = randomUUID()
      const settle = (outcome: ApprovalOutcome) => {
        this.pending.delete(id)
        this.changed()
        resolve(outcome)
      }
      const full = { id, ...question }
      this.pending.set(id, { question: full, settle })
      this.changed(full)
    })
  }

  /** Dangerous calls, or calls without a rule to remember, can only be allowed once. */
  decide(id: string, allow: boolean, scope: ApprovalScope = 'once') {
    const pending = this.pending.get(id)
    if (!pending)
      throw new Error('此授权请求已结束')
    const widen = !pending.question.danger && pending.question.rule
    pending.settle(!allow ? 'rejected' : widen && scope === 'always' ? 'allowed-always' : widen && scope === 'session' ? 'allowed-session' : 'allowed-once')
  }

  cancel() {
    for (const item of [...this.pending.values()]) item.settle('cancelled')
  }
}
