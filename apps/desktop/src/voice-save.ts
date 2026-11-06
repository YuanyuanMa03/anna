import type { SpeechConfig, VoiceConfig, VoiceReply, VoiceRequest } from '../../../packages/voice/contracts'
import { companionPreset } from '../../../packages/voice/presets'

type Kind = 'synthesis' | 'recognition'
const names: Record<Kind, string> = { synthesis: '语音合成', recognition: '语音识别' }
function configure(kind: Kind, config: SpeechConfig, key?: string): VoiceRequest {
  return kind === 'synthesis'
    ? { type: 'voice-configure', config: config as VoiceConfig, ...(key === undefined ? {} : { key }) }
    : { type: 'recognition-configure', config, ...(key === undefined ? {} : { key }) }
}

/**
 * Saves one direction. A new user on the cloud preset saves once: the other direction, if it was never set up and is
 * untouched, follows with its preset and no key of its own, so the shared key serves it. `both` says whether the reply
 * also carries the other side's new settings; otherwise only the saved side may be refreshed, or the other form's
 * unsaved edits would be reset.
 */
export async function saveVoice(invoke: (request: VoiceRequest) => Promise<VoiceReply>, kind: Kind, config: SpeechConfig, key: string | undefined, other: { saved: boolean, dirty: boolean }, open: () => boolean): Promise<{ message: string, reply?: Extract<VoiceReply, { ok: true }>, both?: boolean }> {
  const reply = await invoke(configure(kind, config, key))
  if (!reply.ok)
    return { message: reply.error }
  const otherKind: Kind = kind === 'synthesis' ? 'recognition' : 'synthesis'
  const stored = kind === 'synthesis' ? reply.config : reply.recognition
  const companion = !other.saved && !other.dirty && stored && open() ? companionPreset(stored, otherKind === 'synthesis') : undefined
  if (!companion)
    return { message: `${names[kind]}配置已保存。`, reply, both: false }
  try {
    const second = await invoke(configure(otherKind, companion))
    if (second.ok)
      return { message: '语音识别与合成配置已保存。', reply: second, both: true }
    return { message: `${names[kind]}配置已保存；${names[otherKind]}未能一起保存：${second.error}`, reply, both: false }
  }
  catch {
    return { message: `${names[kind]}配置已保存；${names[otherKind]}未能一起保存，请稍后在下方单独保存。`, reply, both: false }
  }
}
