import type { CharacterId } from '../character/manifest'
import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export interface ModelSettings {
  provider: 'deepseek-official' | 'custom'
  model: string
  baseURL: string
  api: 'anthropic-messages' | 'openai-completions' | 'openai-responses'
}
export interface Settings {
  characterId: CharacterId
  statusEnabled: boolean
  model: ModelSettings
  sessionId?: string
}
export interface Message { role: 'user' | 'assistant', text: string }
export interface RuntimeSnapshot {
  state: 'unconfigured' | 'stopped' | 'starting' | 'ready' | 'running' | 'error'
  error?: string
  plugins: string[]
  tools: string[]
  sessionId?: string
  restored: boolean
  settings: Settings
  hasKey: boolean
  messages: Message[]
}
/** Only these product events cross the preload boundary. DSH objects stay in the host. */
export type AnnaEvent = { type: 'navigate', panel: 'settings' } | { type: 'snapshot', snapshot: RuntimeSnapshot }
  | { type: 'tool', phase: 'call' | 'result', name: string, text: string }
  | { type: 'activity', text: string }
export type Command = { type: 'snapshot' } | { type: 'send', text: string }
  | { type: 'character', id: CharacterId } | { type: 'plugin', enabled: boolean }
  | { type: 'configure', model: ModelSettings, key: string } | { type: 'connect' }
  | { type: 'restart' } | { type: 'stop' } | { type: 'new-session' }
export type Reply = { ok: true, snapshot: RuntimeSnapshot } | { ok: false, error: string }
export const command = defineInvokeEventa<Reply, { command: Command }>('anna:command')
export const runtimeEvent = defineEventa<AnnaEvent>('anna:event')
export interface AnnaBridge {
  invoke: (command: Command) => Promise<Reply>
  subscribe: (listener: (event: AnnaEvent) => void) => () => void
}
