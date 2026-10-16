import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import type { AnnaEvent, Command, Message, RuntimeSnapshot } from '../shared/contracts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EventAdapter } from '../dsh-client/events'
import { Runtime } from '../dsh-client/runtime'
import { SettingsStore, validateModel } from './settings'

export interface CredentialVault { read: () => Promise<string>, write: (key: string) => Promise<void> }
/** One host owns one runtime. Mutating commands reject while a turn or recomposition is active. */
export class Host {
  private runtime?: Runtime
  private adapter = new EventAdapter()
  private stopped = false
  private state: RuntimeSnapshot['state'] = 'stopped'
  private error?: string
  private plugins: string[] = []
  private tools: string[] = []
  private messages: Message[] = []
  private hasKey = false
  private persistedSession = false
  private restored = false
  private mutating = false
  readonly store: SettingsStore
  constructor(readonly root: string, readonly data: string, private vault: CredentialVault, private emit: (event: AnnaEvent) => void) { this.store = new SettingsStore(data) }

  async initialize() {
    await this.store.load()
    await this.store.character()
    this.hasKey = Boolean(await this.vault.read())
    try { this.messages = JSON.parse(await readFile(join(this.data, 'transcript.json'), 'utf8')) as Message[] }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
    this.persistedSession = Boolean(this.store.value.sessionId)
    this.state = this.hasKey ? 'stopped' : 'unconfigured'
    this.publish()
  }

  snapshot(): RuntimeSnapshot { return { state: this.state, error: this.error, plugins: [...this.plugins], tools: [...this.tools], sessionId: this.runtime?.sessionId ?? this.store.value.sessionId, restored: this.restored, settings: structuredClone(this.store.value), hasKey: this.hasKey, messages: [...this.messages] } }
  private publish() { this.emit({ type: 'snapshot', snapshot: this.snapshot() }) }
  private safeError(error: unknown, key: string) { const text = error instanceof Error ? error.message : String(error); return key ? text.split(key).join('[REDACTED]') : text }

  async execute(command: Command): Promise<RuntimeSnapshot> {
    if (command.type === 'snapshot')
      return this.snapshot()
    if (command.type === 'character') {
      if (!['hiyori', 'haru', 'mark'].includes(command.id))
        throw new Error('未知角色')
      this.store.value.characterId = command.id
      await this.store.save()
      this.publish()
      return this.snapshot()
    }
    if (command.type === 'stop') {
      this.stopped = true
      await this.close()
      this.state = 'stopped'
      this.publish()
      return this.snapshot()
    }
    if (this.mutating || this.state === 'running')
      throw new Error('请等待当前对话或运行时组合完成')
    this.mutating = true
    this.stopped = false
    let key = ''
    try {
      key = await this.vault.read()
      if (command.type === 'configure') {
        const model = validateModel(command.model)
        if (command.key && (command.key.length > 8192 || /[\r\n\0]/.test(command.key)))
          throw new Error('API Key 格式无效')
        key = command.key.trim() || key
        if (!key)
          throw new Error('请填写 API Key')
        await this.close()
        await this.vault.write(key)
        this.hasKey = true
        this.store.value.model = model
        await this.store.save()
        this.state = 'stopped'
        this.error = undefined
      }
      else if (command.type === 'plugin') {
        await this.close()
        this.store.value.statusEnabled = command.enabled
        await this.store.save()
        await this.connect(key)
      }
      else if (command.type === 'connect' || command.type === 'restart') {
        if (command.type === 'restart')
          await this.close()
        if (!this.runtime)
          await this.connect(key)
      }
      else if (command.type === 'new-session') {
        await this.close()
        delete this.store.value.sessionId
        this.persistedSession = false
        this.messages = []
        await this.store.save()
        await this.saveTranscript()
        this.state = 'stopped'
      }
      else if (command.type === 'send') {
        if (!command.text.trim() || command.text.length > 30000)
          throw new Error('消息长度必须为 1–30000 个字符')
        if (!this.runtime)
          await this.connect(key)
        const runtime = this.runtime!
        this.state = 'running'
        this.messages.push({ role: 'user', text: command.text.trim() })
        this.publish()
        this.store.value.sessionId = runtime.sessionId
        this.persistedSession = true
        await this.store.save()
        const result = await runtime.run(command.text.trim(), notification => this.notification(notification))
        if (!result.finalResponse)
          throw new Error('DSH 没有返回已提交的助手回复。请检查模型鉴权、端点和工具事件。')
        this.messages.push({ role: 'assistant', text: result.finalResponse })
        this.store.value.sessionId = result.sessionId
        this.persistedSession = true
        await this.store.save()
        await this.saveTranscript()
        this.state = 'ready'
      }
      this.publish()
      return this.snapshot()
    }
    catch (error) {
      if (this.stopped) {
        this.error = 'DSH 进程已关闭。再次发送消息将尝试恢复持久会话，外部进程不会恢复。'
        this.state = 'stopped'
        this.publish()
        return this.snapshot()
      }
      const diagnostic = this.safeError(error, key)
      await writeFile(join(this.data, 'last-error.log'), diagnostic, { mode: 0o600 })
      this.error = diagnostic.split('\n')[0].slice(0, 350)
      this.state = 'error'
      this.publish()
      throw new Error(this.error)
    }
    finally { this.mutating = false }
  }

  private async connect(key: string) {
    if (!key)
      throw new Error('请先在模型设置中填写 API Key')
    this.state = 'starting'
    this.error = undefined
    this.publish()
    this.adapter = new EventAdapter()
    this.runtime = new Runtime({ root: this.root, data: this.data, model: this.store.value.model, key, statusEnabled: this.store.value.statusEnabled, sessionId: this.persistedSession ? this.store.value.sessionId : undefined })
    try {
      const actual = await this.runtime.start()
      this.plugins = actual.plugins
      this.tools = actual.tools
      this.restored = this.runtime.restored
      this.state = 'ready'
    }
    catch (error) { this.runtime = undefined; this.plugins = []; this.tools = []; throw error }
  }

  private notification(notification: HarnessNotification) {
    const event = this.adapter.adapt(notification)
    if (event)
      this.emit(event)
  }

  private async saveTranscript() { await writeFile(join(this.data, 'transcript.json'), JSON.stringify(this.messages), { mode: 0o600 }) }
  async close() {
    if (this.runtime)
      await this.runtime.close()
    this.runtime = undefined
    this.plugins = []
    this.tools = []
    this.restored = false
  }
}
