import type { ApprovalQuestion, TaskResult } from '../shared/contracts'

/**
 * What she says aloud, which is not the reply itself: a chat reply in a sentence or two, and for work a short report
 * built from the task's real numbers plus her own first sentence. Code, paths and lists stay on the screen.
 */
const limit = 90

function speakable(text: string) {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+\.)\s.*$/gm, ' ')
    .replace(/(?:[\w.-]+\/)+[\w.-]+|\b[\w-]+\.(?:ts|js|vue|json|md|py|mjs|css|html)\b/g, ' ')
    .replace(/[*#>|_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whole sentences up to the limit; a single overlong sentence is cut. */
function sentences(text: string, max = limit) {
  const parts = speakable(text).match(/[^。！？!?]+[。！？!?]?/g) ?? []
  let out = ''
  for (const part of parts) {
    const next = out + part.trim()
    if (Array.from(next).length > max) {
      if (!out)
        out = `${Array.from(part.trim()).slice(0, max - 1).join('')}…`
      break
    }
    out = next
  }
  return out
}

export function spokenReport(reply: string, result: TaskResult) {
  if (result.status === 'aborted')
    return '好，我停下了。'
  if (result.status === 'failed')
    return `这次没做完。${sentences(reply, 50)}细节在屏幕上。`.replace(/。。/g, '。')
  const worked = result.changes.length > 0 || result.commands > 0 || result.files.length > 0
  if (!worked)
    return sentences(reply)
  const facts = [
    ...(result.changes.length ? [`改了 ${result.changes.length} 个文件`] : []),
    ...(result.tests === 'passed' ? ['测试都过了'] : result.tests === 'failed' ? ['有测试没过'] : []),
  ]
  const lead = sentences(reply, 60)
  return `${lead}${facts.length ? `${facts.join('，')}。` : ''}细节在屏幕上。`
}

export function spokenApproval(question: Pick<ApprovalQuestion, 'toolName' | 'reason' | 'details' | 'danger'>) {
  const what = Array.from(speakable(question.details).split(/\s+&&\s+|\n/)[0] ?? '').slice(0, 30).join('')
  if (question.danger)
    return `这一步有风险：${question.reason}。请你在屏幕上看一下再决定。`
  return `我想${question.reason}${what ? `：${what}` : ''}。可以的话点一下“允许”。`
}
