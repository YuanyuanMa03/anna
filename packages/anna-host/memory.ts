import type { AnnaTool } from '../kernels/types'
import type { MemoryDraft, MemoryItem, MemoryKind } from '../shared/contracts'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readJson, writeJson } from './json-file'

const limit = 80

/** Lines that look like credentials are never stored. */
export function looksLikeSecret(text: string) { return /sk-|api[_-]?key|password|密码|token/i.test(text) }

/** What the user explicitly asked to remember ("记住：…", "请记住 …", "帮我记住，…"); not a question like "记住了吗？". */
export function explicitMemory(text: string) {
  const lead = /^\s*(?:请|帮我)?记住[\s,:\uFF0C\uFF1A]+/.exec(text)
  if (lead)
    return text.slice(lead[0].length).trim() || undefined
  const request = /^(?:请|帮我)?记住(.+)$/.exec(text.trim())?.[1]?.trim()
  // Natural Chinese imperatives need no colon; questions and acknowledgements are not requests.
  return request && !request.startsWith('了') && !/(?:[吗么]|没有|[没？?])$/.test(request) ? request : undefined
}

/** Who wrote a line, as the diary says it: "Anna 记下", or that nobody recorded it. */
export function signature(item: MemoryItem) { return item.by ? `${item.by} 记下` : '没记录是谁记的' }

/** Long-term memory about the user, kept by Anna (not in any workspace) and visible/deletable in the UI. */
export class MemoryStore {
  items: MemoryItem[] = []
  private dismissed: string[] = []
  private hash(text: string) { return createHash('sha256').update(text).digest('hex') }
  constructor(private directory: string) {}
  private get file() { return join(this.directory, 'memory.json') }

  async load() {
    this.items = await readJson(this.file, this.items)
    this.dismissed = await readJson(join(this.directory, 'memory-dismissed.json'), [])
  }

  private async save() { await writeJson(this.file, this.items) }

  /** The stored line (an existing one keeps its first writer), or undefined for a line that looks like a credential. */
  async remember(text: string, by?: string, kind: MemoryKind = 'preference'): Promise<MemoryItem | undefined> {
    const body = text.trim().slice(0, 300)
    if (!body)
      throw new Error('记忆内容为空')
    if (looksLikeSecret(body))
      return undefined
    const existing = this.items.find(item => item.text === body)
    if (existing)
      return existing
    const item: MemoryItem = { kind, id: randomUUID(), text: body, createdAt: new Date().toISOString(), ...(by ? { by } : {}) }
    this.items = [...this.items, item].slice(-limit)
    await this.save()
    return item
  }

  validate(draft: MemoryDraft): MemoryDraft {
    const text = String(draft.text).trim()
    if (!text || text.length > 300 || !['preference', 'agreement', 'experience'].includes(draft.kind))
      throw new Error('记忆需要 1–300 个字符和有效分类')
    if (looksLikeSecret(text))
      throw new Error('这条看起来含有凭据，不能记住')
    return { text, kind: draft.kind }
  }

  async correct(id: string, draft: MemoryDraft) {
    const clean = this.validate(draft)
    const item = this.items.find(item => item.id === id)
    if (!item)
      throw new Error('这条记忆已不存在')
    Object.assign(item, clean, { updatedAt: new Date().toISOString() })
    await this.save()
  }

  async forget(id: string) {
    this.items = this.items.filter(item => item.id !== id)
    await this.save()
  }

  /** Instructions for the kernel: her memory of the user, and how to use the memory tool. */
  instructions(query?: string) {
    const terms = query?.toLowerCase().match(/[a-z0-9]+|[\u4E00-\u9FFF]{2}/g) ?? []
    const score = (item: MemoryItem) => terms.filter(term => item.text.toLowerCase().includes(term)).length
    const chosen = query ? [...this.items].reverse().filter(item => score(item) > 0 || item.kind !== 'experience').sort((a, b) => score(b) - score(a)).slice(0, 8) : this.items.slice(-8)
    let budget = 1600
    const selected = chosen.filter((item) => { budget -= item.text.length; return budget >= 0 })
    const list = selected.length ? selected.map(item => `- ${item.text}（${signature(item)}）`).join('\n') : '（暂无）'
    return `## 关于用户的长期记忆\n这是你的日记，以下是用户允许你记住的事。每条后面的括号写着是谁记下的：提到时照实说出处，不是你记的就不要说成“我记下的”。记忆也可能过时，与用户当前说法冲突时以当前为准：\n${list}\n\n需要长期记住用户的偏好、习惯或约定时，调用 anna_memory 的 remember；用户要求忘记时调用 forget。不要把记忆写进工作区文件。不要记住密钥、密码或其他敏感信息。`
  }

  /** `writer`: who is on stage when a line is stored, so the diary can say whose it is. */
  tool(onChange: (forgotten?: boolean) => void, writer: () => string, confirm?: (draft: MemoryDraft) => Promise<MemoryDraft | false | undefined>): AnnaTool {
    return {
      name: 'anna_memory',
      label: '记忆',
      description: '管理关于用户的长期记忆，换大脑后依然有效。action=remember 记住一条（text），action=forget 按 text 中的关键词忘记匹配的条目，action=list 列出全部。',
      parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['preference', 'agreement', 'experience'] }, action: { type: 'string', enum: ['remember', 'forget', 'list'] }, text: { type: 'string' } }, required: ['action'] },
      execute: async (args) => {
        const action = String(args.action)
        const text = String(args.text ?? '')
        if (action === 'remember') {
          if (looksLikeSecret(text))
            return '这条看起来包含凭据，没有记录。'
          let draft = this.validate({ text, kind: (args.kind ?? 'preference') as MemoryKind })
          const existing = this.items.find(item => item.text === draft.text)
          if (existing)
            return `已记住：${existing.text}`
          if (this.dismissed.includes(this.hash(draft.text)))
            return '用户之前没有选择保存这条内容，不要重复提议。'
          if (confirm) {
            const approved = await confirm(draft)
            if (!approved) {
              if (approved === false) {
                this.dismissed = [...this.dismissed, this.hash(draft.text)].slice(-80)
                await writeJson(join(this.directory, 'memory-dismissed.json'), this.dismissed)
              }
              return '没有记录：用户未确认这条记忆。'
            }
            draft = this.validate(approved)
          }
          await this.remember(draft.text, writer(), draft.kind)
          onChange()
          return `已记住：${draft.text}`
        }
        if (action === 'forget') {
          const matched = this.items.filter(item => text && item.text.includes(text))
          for (const item of matched) await this.forget(item.id)
          onChange(Boolean(matched.length))
          return matched.length ? `已忘记 ${matched.length} 条。` : '没有找到匹配的记忆。'
        }
        return this.items.length ? this.items.map(item => `- ${item.text}`).join('\n') : '还没有任何记忆。'
      },
    }
  }
}
