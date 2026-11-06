import type { ApprovalQuestion } from './contracts'

/** The complete set the card displays and the Host may remember; an explicit empty/incomplete set never widens access. */
export function approvalRules(question: Pick<ApprovalQuestion, 'rule' | 'rules' | 'danger' | 'memory'>): string[] {
  if (question.danger || question.memory)
    return []
  const rules = question.rules === undefined ? (question.rule === undefined ? [] : [question.rule]) : question.rules
  if (!Array.isArray(rules) || !rules.length || rules.some(rule => typeof rule !== 'string' || !rule.trim()))
    return []
  return [...new Set(rules.map(rule => rule.trim()))]
}
