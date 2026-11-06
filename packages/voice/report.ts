import type { ApprovalQuestion, TaskResult } from '../shared/contracts'

/**
 * What she says aloud, which is not the reply itself: a chat reply in a sentence or two, and for work a short report
 * built from the task's real numbers plus her own first sentence. Code, paths, links and lists stay on the screen.
 */
const limit = 90
const closing = /[。！？!?…]$/

function speakable(text: string) {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*(?:[-*+]|\d+\.)\s.*$/gm, ' ')
    // A path: starts at /, ./ or ~/, or ends in a file name with an extension. Not 1/2, 11/06 or TCP/IP.
    .replace(/(?<![\w/])(?:~|\.{1,2})?\/[\w./-]+|(?:[\w-]+\/)+[\w-]+\.[a-z]{1,5}\b|\b[\w-]+\.(?:ts|js|vue|json|md|py|mjs|css|html|txt|yml|yaml)\b/gi, ' ')
    .replace(/[*#_~]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([，。！？、；：,.!?;:])/g, '$1')
    .replace(/(\p{Script=Han})\s+(\p{Script=Han})/gu, '$1$2')
    .trim()
}

/** Cut at the last comma or word boundary before `max`, so she never stops mid-word. */
function clip(sentence: string, max: number) {
  const chars = Array.from(sentence)
  if (chars.length <= max)
    return sentence
  const head = chars.slice(0, max - 1).join('')
  const at = Math.max(head.lastIndexOf('，'), head.lastIndexOf(','), head.lastIndexOf('、'), head.lastIndexOf(' '))
  return `${(at > max / 3 ? head.slice(0, at) : head).trim()}…`
}

/** Whole sentences up to `max`; when the next one does not fit, as much of it as reads naturally. */
function sentences(plain: string, max = limit) {
  const parts = plain.match(/[^。！？!?]+[。！？!?]?|[^.]+\.(?=\s|$)/g)?.map(part => part.trim()).filter(Boolean) ?? []
  let out = ''
  for (const part of parts) {
    const next = out ? `${out}${/[.!?]$/.test(out) ? ' ' : ''}${part}` : part
    if (Array.from(next).length <= max) {
      out = next
      continue
    }
    // A short opener ("当然可以！") alone says nothing: carry on into the next sentence, clipped.
    if (Array.from(out).length < 20)
      out = clip(next, max)
    break
  }
  return out
}

export function spokenReport(reply: string, result: TaskResult) {
  if (result.status === 'aborted')
    return '好，我停下了。'
  const plain = speakable(reply)
  const said = sentences(plain, result.status === 'failed' ? 50 : result.changes.length || result.tests ? 60 : limit)
  if (result.status === 'failed')
    return `这次没做完。${said ? `${said}${closing.test(said) ? '' : '。'}` : ''}细节在屏幕上。`
  const facts = [
    ...(result.changes.length ? [`改了 ${result.changes.length} 个文件`] : []),
    ...(result.tests === 'passed' ? ['测试都过了'] : result.tests === 'failed' ? ['有测试没过'] : []),
  ]
  // More on screen than she said: code, lists, a clipped answer, or the changes themselves.
  const more = facts.length > 0 || said.length < plain.length || plain.length < reply.trim().length * 0.6
  if (!said)
    return reply.trim() || facts.length ? `好了${facts.length ? `，${facts.join('，')}` : ''}，细节在屏幕上。` : ''
  return `${said}${closing.test(said) ? '' : '。'}${facts.length ? `${facts.join('，')}。` : ''}${more ? '细节在屏幕上。' : ''}`
}

/** One line for an approval: the reason as the permission system wrote it, plus a file name or the command's first words. */
export function spokenApproval(question: Pick<ApprovalQuestion, 'toolName' | 'reason' | 'details' | 'danger'>) {
  if (question.danger)
    return `这一步有风险：${question.reason}。请你在屏幕上看一下再决定。`
  const first = question.details.trim().split('\n')[0] ?? ''
  const what = ['edit', 'write', 'read'].includes(question.toolName)
    ? (first.split(/[\\/]/).pop() ?? '')
    : first.split(/\s+/).filter(word => /^[\w.:-]+$/.test(word) && !word.startsWith('-')).slice(0, 2).join(' ')
  return `需要你确认：${question.reason}${what && Array.from(what).length <= 30 ? ` ${what}` : ''}。`
}
