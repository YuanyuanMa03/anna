import type { AnnaTool } from '../kernels/types'
import type { MemoryItem } from '../shared/contracts'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readJson, writeJson } from './json-file'

const limit = 80

/** Lines that look like credentials are never stored. */
export function looksLikeSecret(text: string) { return /sk-|api[_-]?key|password|密码|token/i.test(text) }

/** What the user explicitly asked to remember ("记住：…", "请记住 …", "帮我记住，…"); not a question like "记住了吗？". */
export function explicitMemory(text: string) {
  const lead = /^\s*(?:请|帮我)?记住[\s,:\uFF0C\uFF1A]+/.exec(text)
  return lead ? text.slice(lead[0].length).trim() || undefined : undefined
}

/** Who wrote a line, as the diary says it: "Anna 记下", or that nobody recorded it. */
export function signature(item: MemoryItem) { return item.by ? `${item.by} 记下` : '没记录是谁记的' }

/** Long-term memory about the user, kept by Anna (not in any workspace) and visible/deletable in the UI. */
export class MemoryStore {
  items: MemoryItem[] = []
  constructor(private directory: string) {}
  private get file() { return join(this.directory, 'memory.json') }

  async load() { this.items = await readJson(this.file, this.items) }
  private async save() { await writeJson(this.file, this.items) }

  /** The stored line (an existing one keeps its first writer), or undefined for a line that looks like a credential. */
  async remember(text: string, by?: string): Promise<MemoryItem | undefined> {
    const body = text.trim().slice(0, 300)
    if (!body)
      throw new Error('记忆内容为空')
    if (looksLikeSecret(body))
      return undefined
    const existing = this.items.find(item => item.text === body)
    if (existing)
      return existing
    const item: MemoryItem = { id: randomUUID(), text: body, createdAt: new Date().toISOString(), ...(by ? { by } : {}) }
    this.items = [...this.items, item].slice(-limit)
    await this.save()
    return item
  }

  async forget(id: string) {
    this.items = this.items.filter(item => item.id !== id)
    await this.save()
  }

  /** Instructions for the kernel: the memory every companion shares, and how to use the memory tool. */
  instructions() {
    const list = this.items.length ? this.items.map(item => `- ${item.text}（${signature(item)}）`).join('\n') : '（暂无）'
    return `## 关于用户的长期记忆\n这是伙伴们共用的一本日记，以下是用户允许大家记住的事。每条后面的括号写着是谁记下的：提到时照实说出处，不是你记的就不要说成“我记下的”。记忆也可能过时，与用户当前说法冲突时以当前为准：\n${list}\n\n需要长期记住用户的偏好、习惯或约定时，调用 anna_memory 的 remember；用户要求忘记时调用 forget。不要把记忆写进工作区文件。不要记住密钥、密码或其他敏感信息。`
  }

  /** `writer`: who is on stage when a line is stored, so the diary can say whose it is. */
  tool(onChange: () => void, writer: () => string): AnnaTool {
    return {
      name: 'anna_memory',
      label: '共同记忆',
      description: '管理伙伴们共用的、关于用户的长期记忆，换伙伴后依然有效。action=remember 记住一条（text），action=forget 按 text 中的关键词忘记匹配的条目，action=list 列出全部。',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['remember', 'forget', 'list'] }, text: { type: 'string' } }, required: ['action'] },
      execute: async (args) => {
        const action = String(args.action)
        const text = String(args.text ?? '')
        if (action === 'remember') {
          if (!(await this.remember(text, writer())))
            return '这条看起来包含凭据，没有记录。'
          onChange()
          return `已记住：${text}`
        }
        if (action === 'forget') {
          const matched = this.items.filter(item => text && item.text.includes(text))
          for (const item of matched) await this.forget(item.id)
          onChange()
          return matched.length ? `已忘记 ${matched.length} 条。` : '没有找到匹配的记忆。'
        }
        return this.items.length ? this.items.map(item => `- ${item.text}`).join('\n') : '还没有任何记忆。'
      },
    }
  }
}
