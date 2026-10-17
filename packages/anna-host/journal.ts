import type { FileChange, Origin } from '../shared/contracts'
import { join } from 'node:path'
import { readJson, writeJson } from './json-file'

export interface JournalEntry {
  taskId: string
  at: string
  workspace: string
  status: 'completed' | 'aborted' | 'failed'
  origin: Origin
  /** What the user asked for, shortened. */
  request: string
  changes: { path: string, status: FileChange['status'] }[]
  /** Collaborators (Claude Code, Codex…) that did the work; empty when the companion did it with its own tools. */
  by?: string[]
  undone?: boolean
}

const statusWords: Record<JournalEntry['status'], string> = { completed: '完成', aborted: '被用户中断', failed: '没有完成' }
const changeWords: Record<FileChange['status'], string> = { added: '新增', modified: '修改', deleted: '删除' }

const limit = 40

/** "2026-10-17 17:42" in the user's own time zone, the way she would say it. */
function localTime(iso: string) {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * What Anna actually did, kept outside any kernel session. A new session starts with no memory of earlier turns;
 * the journal lets her say "I changed that in an earlier session" instead of denying it.
 */
export class TaskJournal {
  entries: JournalEntry[] = []
  constructor(private directory: string) {}
  private get file() { return join(this.directory, 'journal.json') }

  async load() { this.entries = await readJson(this.file, this.entries) }
  private async save() { await writeJson(this.file, this.entries) }

  async record(entry: JournalEntry) {
    this.entries = [...this.entries.filter(item => item.taskId !== entry.taskId), entry].slice(-limit)
    await this.save()
  }

  async markUndone(taskId: string) {
    const entry = this.entries.find(item => item.taskId === taskId)
    if (!entry)
      return
    entry.undone = true
    await this.save()
  }

  /** A note for a fresh session: the recent tasks in this workspace, newest last. Empty when there is nothing to tell. */
  brief(workspace: string, count = 8) {
    const recent = this.entries.filter(entry => entry.workspace === workspace).slice(-count)
    if (!recent.length)
      return ''
    const lines = recent.map((entry) => {
      const status = entry.undone ? '改动已被用户撤销' : statusWords[entry.status]
      const files = entry.changes.length ? `；改动：${entry.changes.map(change => `${change.path}（${changeWords[change.status]}）`).join('、')}` : ''
      const by = entry.by?.length ? `；活是派给 ${entry.by.join('、')} 做的，改动出自它们` : ''
      return `- ${localTime(entry.at)} · ${status} ·「${entry.request}」${files}${by}`
    })
    return `[Anna 系统提示] 这是一个新会话，你看不到之前的对话。下面是这个工作文件夹里最近的任务记录（来自检查点，真实可信；命令造成的改动不在其中；没写派给谁的，是伙伴自己用工具做的）：\n${lines.join('\n')}\n文件现在的样子以你实际查看为准。被问到“是谁改的”时，以这份记录为依据；记录里没有的，就说没有记录，不要断言不是你做的。`
  }
}
