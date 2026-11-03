import type { HearingMetadata } from './hearing'
import { defineInvokeEventa } from '@moeru/eventa'

export interface VoiceConfig { baseURL: string, model: string, voice: string }
export interface VisionConfig { baseURL: string, model: string }
export interface Observation { text: string, at: string, source: string, model: string }
export interface ScreenSource { id: string, name: string, thumbnail: string }
export interface HearingModel { id: string, sha256: string, size: number, metadata: HearingMetadata }
export type HearingRequest = { type: 'hearing-status' } | { type: 'hearing-import', id: string } | { type: 'hearing-read', id: string, offset: number } | { type: 'hearing-remove' }
export type ScreenRequest = { type: 'screen-sources' } | { type: 'screen-select', id: string } | { type: 'screen-clear' }
export type VisionRequest = { type: 'vision-status' } | { type: 'vision-configure', config: VisionConfig, key?: string } | { type: 'vision-read', id: string, image: string, question: string, source: string }
export type SenseRequest = HearingRequest | ScreenRequest | VisionRequest | { type: 'voice-status' } | { type: 'voice-configure', config: VoiceConfig, key?: string } | { type: 'voice-generate', id: string, text: string } | { type: 'cancel', id: string }
export type SenseReply = { ok: true, config?: VoiceConfig, hasKey?: boolean, audio?: { base64: string, mime: string }, vision?: VisionConfig, observation?: Observation, sources?: ScreenSource[], hearingModel?: HearingModel, chunk?: string } | { ok: false, error: string }
export const senseCommand = defineInvokeEventa<SenseReply, { request: SenseRequest }>('anna:senses')
