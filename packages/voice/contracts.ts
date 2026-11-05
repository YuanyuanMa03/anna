import { defineInvokeEventa } from '@moeru/eventa'

export type VoiceMode = 'local' | 'cloud'
export interface SpeechConfig { mode?: VoiceMode, baseURL: string, model: string }
export interface VoiceConfig extends SpeechConfig { voice: string }
export type VoiceRequest
  = | { type: 'voice-status' }
    | { type: 'voice-configure', config: VoiceConfig, key?: string }
    | { type: 'recognition-configure', config: SpeechConfig, key?: string }
    | { type: 'voice-generate', id: string, text: string }
    | { type: 'voice-transcribe', id: string, audio: string }
    | { type: 'cancel', id: string }
export type VoiceReply
  = | { ok: true, config?: VoiceConfig, recognition?: SpeechConfig, hasKey?: boolean, recognitionHasKey?: boolean, audio?: { base64: string, mime: string }, transcript?: string }
    | { ok: false, error: string }
export const voiceCommand = defineInvokeEventa<VoiceReply, { request: VoiceRequest }>('anna:voice')
