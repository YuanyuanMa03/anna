import type { AnnaTool } from '../kernels/types'
import type { MemoryItem } from '../shared/contracts'
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const limit = 80

/** Long-term memory about the user, kept by Anna (not in any workspace) and visible/deletable in the UI. */
export class MemoryStore {
  items: MemoryItem[] = []
  constructor(private directory: string) {}
  private get file() { return join(this.directory, 'memory.json') }

  async load() {
    try { this.items = JSON.parse(await readFile(this.file, 'utf8')) as MemoryItem[] }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
  }

  private async save() {
    await writeFile(`${this.file}.tmp`, JSON.stringify(this.items, null, 1), { mode: 0o600 })
    await rename(`${this.file}.tmp`, this.file)
  }

  async remember(text: string) {
    const body = text.trim().slice(0, 300)
    if (!body)
      throw new Error('记忆内容为空')
    const existing = this.items.find(item => item.text === body)
    if (existing)
      return existing
    const item: MemoryItem = { id: randomUUID(), text: body, createdAt: new Date().toISOString() }
    this.items = [...this.items, item].slice(-limit)
    await this.save()
    return item
  }

  async forget(id: string) {
    this.items = this.items.filter(item => item.id !== id)
    await this.save()
  }

  /** Instructions for the kernel: what Anna remembers and how to use the memory tool. */
  instructions() {
    const list = this.items.length ? this.items.map(item => `- ${item.text}`).join('\n') : '（暂无）'
    return `## 关于用户的长期记忆\n以下是用户允许你记住的事（可能过时，与用户当前说法冲突时以当前为准）：\n${list}\n\n需要长期记住用户的偏好、习惯或约定时，调用 anna_memory 的 remember；用户要求忘记时调用 forget。不要把记忆写进工作区文件。不要记住密钥、密码或其他敏感信息。`
  }

  tool(onChange: () => void): AnnaTool {
    return {
      name: 'anna_memory',
      label: 'Anna 记忆',
      description: '管理 Anna 对用户的长期记忆。action=remember 记住一条（text），action=forget 按 text 中的关键词忘记匹配的条目，action=list 列出全部。',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['remember', 'forget', 'list'] }, text: { type: 'string' } }, required: ['action'] },
      execute: async (args) => {
        const action = String(args.action)
        const text = String(args.text ?? '')
        if (action === 'remember') {
          if (/sk-|api[_-]?key|password|密码|token/i.test(text))
            return '这条看起来包含凭据，没有记录。'
          await this.remember(text)
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
