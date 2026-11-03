import type { ExternalHistoryPage, ExternalSession, HistoryPreview, Message } from '../shared/contracts'
import type { AgentLocation } from './codex-rpc'
import { randomUUID } from 'node:crypto'
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RpcError, withCodex } from './codex-rpc'

export interface HistoryOptions {
  locate: (agent: string) => Promise<AgentLocation | undefined>
  claude?: () => Promise<Pick<typeof import('@anthropic-ai/claude-agent-sdk'), 'listSessions' | 'getSessionMessages' | 'forkSession'>>
}
function textOf(value: unknown): string {
  if (typeof value === 'string')
    return value.slice(0, 4000)
  if (Array.isArray(value))
    return value.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n').slice(0, 4000)
  return ''
}

/** Only a session explicitly listed by this UI instance can be previewed or branched. */
export class ExternalHistory {
  private listed = new Map<string, ExternalSession>()
  constructor(private options: HistoryOptions) {}
  private claude() { return this.options.claude?.() ?? import('@anthropic-ai/claude-agent-sdk') }
  private async codex<T>(cwd: string, work: Parameters<typeof withCodex<T>>[2]) {
    const location = await this.options.locate('codex')
    if (!location)
      throw new Error('请先安装 Codex')
    return withCodex(location, cwd, work)
  }

  async list(agent: 'claude' | 'codex', cwd: string, all: boolean, cursor?: string): Promise<ExternalHistoryPage> {
    if (!['claude', 'codex'].includes(agent))
      throw new Error('这个大脑暂不支持历史接入')
    let items: ExternalSession[]
    let nextCursor: string | undefined
    if (agent === 'claude') {
      const offset = cursor ? Number(cursor) : 0
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000)
        throw new Error('历史分页参数无效')
      const rows = await (await this.claude()).listSessions({ ...(all ? {} : { dir: cwd, includeWorktrees: false }), limit: offset + 21 })
      items = rows.slice(offset, offset + 20).map(row => ({ id: row.sessionId, agent, title: row.summary.slice(0, 200), workspace: row.cwd, updatedAt: new Date(row.lastModified).toISOString() }))
      nextCursor = rows.length > offset + 20 ? String(offset + 20) : undefined
    }
    else {
      const page = await this.codex(cwd, request => request('thread/list', { limit: 20, cursor, sortKey: 'updated_at', ...(all ? {} : { cwd }), sourceKinds: ['cli', 'vscode', 'appServer', 'exec'] }))
      items = (page.data ?? []).map((row: any) => ({ id: row.id, agent, title: String(row.name || row.preview || row.id).slice(0, 200), workspace: row.cwd, updatedAt: new Date(row.updatedAt * 1000).toISOString() }))
      nextCursor = page.nextCursor || undefined
    }
    if (!cursor)
      this.listed.clear()
    for (const item of items) this.listed.set(`${agent}:${item.id}`, item)
    return { agent, all, items, nextCursor }
  }

  private selected(agent: 'claude' | 'codex', id: string) {
    const item = this.listed.get(`${agent}:${id}`)
    if (!item)
      throw new Error('请先在历史列表中选择会话')
    return item
  }

  async preview(agent: 'claude' | 'codex', id: string, cwd: string, cursor?: string): Promise<HistoryPreview> {
    const session = this.selected(agent, id)
    let messages: Message[] = []
    let nextCursor: string | undefined
    if (agent === 'claude') {
      const offset = cursor ? Number(cursor) : 0
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
        throw new Error('历史分页参数无效')
      const rows = await (await this.claude()).getSessionMessages(id, { dir: session.workspace, offset, limit: 21 })
      messages = rows.slice(0, 20).filter(row => !row.parent_tool_use_id && (row.type === 'user' || row.type === 'assistant')).map(row => ({ role: row.type as 'user' | 'assistant', text: textOf((row.message as any)?.content) })).filter(row => row.text)
      nextCursor = rows.length > 20 ? String(offset + 20) : undefined
    }
    else {
      const page = await this.codex(cwd, async (request) => {
        try { return await request('thread/items/list', { threadId: id, limit: 20, cursor, sortDirection: 'asc' }) }
        catch (error) {
          if (!(error instanceof RpcError) || ![-32601, -32600].includes(error.code ?? 0))
            throw error
          const legacy = await request('thread/read', { threadId: id, includeTurns: true })
          return { data: (legacy.thread?.turns ?? []).flatMap((turn: any) => turn.items.map((item: any) => ({ item }))) }
        }
      })
      messages = (page.data ?? []).flatMap(({ item }: any): Message[] => item.type === 'userMessage' ? [{ role: 'user', text: textOf(item.content) }] : item.type === 'agentMessage' ? [{ role: 'assistant', text: textOf(item.text) }] : []).filter((row: Message) => row.text)
      nextCursor = page.nextCursor || undefined
    }
    return { session, messages, nextCursor }
  }

  async fork(agent: 'claude' | 'codex', id: string, cwd: string, data: string, useCurrentDirectory = false) {
    const session = this.selected(agent, id)
    if (!useCurrentDirectory && (!session.workspace || await realpath(session.workspace).catch(() => '') !== await realpath(cwd)))
      throw new Error('请先将工作目录切换到这个历史会话的目录；原目录不可用时请重新选择目录')
    if (!(await stat(cwd)).isDirectory())
      throw new Error('原工作目录不可用，请重新选择目录')
    const preview = await this.preview(agent, id, cwd)
    const forkedId = agent === 'claude'
      ? (await (await this.claude()).forkSession(id, { dir: session.workspace })).sessionId
      : await this.codex(cwd, async request => (await request('thread/fork', { threadId: id, cwd, excludeTurns: true })).thread?.id)
    if (!forkedId || forkedId === id)
      throw new Error('这个版本未能创建新分支，原会话没有被续接')
    const directory = join(data, 'external-sessions')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const file = join(directory, `${agent}-${randomUUID()}.json`)
    await writeFile(file, JSON.stringify({ agentSessionId: forkedId, source: { agent, id, title: session.title }, entries: [...preview.messages.map(message => ({ kind: message.role, text: message.text, origin: 'desktop' })), { kind: 'notice', data: { text: `从 ${agent} 历史「${session.title}」创建了 Anna 分支；此前内容来自原 agent。` } }] }), { mode: 0o600 })
    return file
  }
}
