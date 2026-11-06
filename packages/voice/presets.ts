import type { SpeechConfig, VoiceMode, VoiceProtocol } from './contracts'

/**
 * What a new voice form starts with. The cloud preset is Xiaomi MiMo's Token Plan: speech through chat completions,
 * reachable from mainland China, one key for recognition, synthesis and the brain. Pay-as-you-go keys (`sk-`) use
 * https://api.xiaomimimo.com/v1 instead. Every field stays editable.
 * The local preset is the optional service in scripts/local-speech, which nothing installs or starts.
 */
const presets: Record<VoiceMode, { baseURL: string, protocol: VoiceProtocol, recognition: string, synthesis: string, voice: string }> = {
  cloud: { baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', protocol: 'chat', recognition: 'mimo-v2.5-asr', synthesis: 'mimo-v2.5-tts', voice: '冰糖' },
  local: { baseURL: 'http://127.0.0.1:17861/v1', protocol: 'audio', recognition: 'paraformer-local', synthesis: 'kokoro-local', voice: 'anna' },
}

export const cloudKeyPage = 'https://platform.xiaomimimo.com/'
/** Where MiMo's pay-as-you-go (`sk-`) keys work; the preset address only takes Token Plan keys. */
export const payAsYouGoURL = 'https://api.xiaomimimo.com/v1'
/** MiMo's built-in voices for `mimo-v2.5-tts`, suggested in the form; any other ID can still be typed. */
export const cloudVoices = ['冰糖', '茉莉', '苏打', '白桦', 'mimo_default', 'Mia', 'Chloe', 'Milo', 'Dean']

/**
 * The other direction's settings when one is saved on the cloud preset's address, so a new user enters one key and saves
 * once. Anything else (another address, local) is left for the user to set up.
 */
export function companionPreset(saved: SpeechConfig, synthesis: boolean): (SpeechConfig & { voice: string }) | undefined {
  if (saved.mode !== 'cloud' || saved.baseURL !== presets.cloud.baseURL || saved.protocol !== presets.cloud.protocol)
    return undefined
  return { mode: 'cloud', ...speechDefaults('cloud', synthesis) }
}

export function speechDefaults(mode: VoiceMode, synthesis: boolean): { baseURL: string, protocol: VoiceProtocol, model: string, voice: string } {
  const preset = presets[mode]
  return { baseURL: preset.baseURL, protocol: preset.protocol, model: synthesis ? preset.synthesis : preset.recognition, voice: preset.voice }
}
