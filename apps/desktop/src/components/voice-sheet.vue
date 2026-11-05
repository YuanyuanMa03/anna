<script setup lang="ts">
import type { SpeechConfig, VoiceConfig } from '../../../../packages/voice/contracts'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { recordingWav } from '../voice-audio'
import MicrophonePanel from './microphone-panel.vue'
import VoiceEndpoint from './voice-endpoint.vue'

defineProps<{ canTalk: boolean }>()
const emit = defineEmits<{ close: [], transcript: [text: string], talk: [text: string] }>()
const synthesis = ref<VoiceConfig>()
const recognition = ref<SpeechConfig>()
const synthesisHasKey = ref(false)
const recognitionHasKey = ref(false)
const synthesisDirty = ref(false)
const recognitionDirty = ref(false)
const loading = ref(true)
const settingsOpen = ref(false)
const busy = ref(false)
const message = ref('')
const transcript = ref('')
const text = ref('你好，很高兴和你一起做事。')
const audioURL = ref('')
const audioMime = ref('audio/wav')
let closed = false
let active: { id: string, controller: AbortController } | undefined
function releaseAudio() {
  if (audioURL.value)
    URL.revokeObjectURL(audioURL.value)
  audioURL.value = ''
}
function stop() {
  const request = active
  active = undefined
  request?.controller.abort()
  if (request)
    void window.anna.voice({ type: 'cancel', id: request.id }).catch(() => {})
  busy.value = false
}
async function save(kind: 'synthesis' | 'recognition', config: VoiceConfig, key?: string) {
  if (busy.value || loading.value)
    return
  busy.value = true
  try {
    const result = await window.anna.voice(kind === 'synthesis' ? { type: 'voice-configure', config, key } : { type: 'recognition-configure', config, key })
    if (closed)
      return
    if (!result.ok) { message.value = result.error; return }
    // Update only the saved form; unsaved edits in the other form stay intact.
    if (kind === 'synthesis') { synthesis.value = result.config; synthesisHasKey.value = Boolean(result.hasKey); releaseAudio() }
    else { recognition.value = result.recognition; recognitionHasKey.value = Boolean(result.recognitionHasKey); transcript.value = '' }
    message.value = `${kind === 'synthesis' ? '语音合成' : '语音识别'}配置已保存。`
  }
  catch {
    if (!closed)
      message.value = '配置未保存，请稍后重试'
  }
  finally {
    if (!closed)
      busy.value = false
  }
}
async function transcribe(file: File) {
  if (busy.value || !recognition.value || recognitionDirty.value)
    return
  const request = { id: crypto.randomUUID(), controller: new AbortController() }
  active = request
  busy.value = true
  transcript.value = ''
  message.value = `正在通过${recognition.value.mode === 'local' ? '本地服务' : '云端 API'}识别…`
  try {
    const audio = await recordingWav(file, request.controller.signal)
    request.controller.signal.throwIfAborted()
    const result = await window.anna.voice({ type: 'voice-transcribe', id: request.id, audio })
    if (closed || active !== request)
      return
    if (!result.ok) { message.value = result.error; return }
    transcript.value = result.transcript ?? ''
    message.value = transcript.value ? '识别完成，请核对文字后发送。' : '没有识别出文字，请重新录音。'
  }
  catch (error) {
    if (!closed && active === request)
      message.value = error instanceof Error ? error.message : '语音识别失败'
  }
  finally { if (active === request) { active = undefined; busy.value = false } }
}
function selectAudio(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file)
    void transcribe(file)
  input.value = ''
}
async function generate() {
  if (busy.value || !synthesis.value || synthesisDirty.value)
    return
  const request = { id: crypto.randomUUID(), controller: new AbortController() }
  active = request
  busy.value = true
  releaseAudio()
  message.value = '正在生成语音文件，不自动播放…'
  try {
    const result = await window.anna.voice({ type: 'voice-generate', id: request.id, text: text.value })
    if (closed || active !== request)
      return
    if (!result.ok) { message.value = result.error; return }
    if (!result.audio)
      throw new Error('没有收到音频')
    const bytes = Uint8Array.from(atob(result.audio.base64), char => char.charCodeAt(0))
    audioMime.value = result.audio.mime
    audioURL.value = URL.createObjectURL(new Blob([bytes], { type: result.audio.mime }))
    message.value = '音频已生成，可下载试听。'
  }
  catch {
    if (!closed && active === request)
      message.value = '语音生成失败，请检查服务配置'
  }
  finally { if (active === request) { active = undefined; busy.value = false } }
}
onMounted(async () => {
  try {
    const result = await window.anna.voice({ type: 'voice-status' })
    if (closed)
      return
    if (!result.ok) { message.value = result.error; return }
    synthesis.value = result.config
    recognition.value = result.recognition
    settingsOpen.value ||= !result.config || !result.recognition
    synthesisHasKey.value = Boolean(result.hasKey)
    recognitionHasKey.value = Boolean(result.recognitionHasKey)
  }
  catch {
    if (!closed)
      message.value = '语音服务尚未就绪，请关闭后重试'
  }
  finally {
    if (!closed)
      loading.value = false
  }
})
onBeforeUnmount(() => { closed = true; stop(); releaseAudio() })
</script>

<template>
  <div class="voice-backdrop" @click.self="emit('close')">
    <section class="voice-sheet" role="dialog" aria-modal="true" aria-label="语音对话">
      <header><h2>语音对话</h2><button @click="emit('close')">关闭</button></header>
      <p>识别和合成可分别选择本地部署或云端 API，继续使用你当前选择的大脑。</p>
      <details :open="settingsOpen" @toggle="settingsOpen = ($event.target as HTMLDetailsElement).open">
        <summary>语音设置</summary>
        <VoiceEndpoint label="语音识别" :config="recognition" :has-key="recognitionHasKey" :disabled="loading || busy" @dirty="value => recognitionDirty = value" @save="(config, key) => save('recognition', config, key)" />
        <VoiceEndpoint label="语音合成" synthesis :config="synthesis" :has-key="synthesisHasKey" :disabled="loading || busy" @dirty="value => synthesisDirty = value" @save="(config, key) => save('synthesis', config, key)" />
      </details>
      <p v-if="recognition">识别目标：{{ recognition.baseURL }}</p>
      <p v-if="recognitionDirty">识别配置已改动，请先保存。</p>
      <MicrophonePanel :ready="Boolean(recognition) && !recognitionDirty && !loading" :disabled="busy" :local="recognition?.mode === 'local'" @recording="transcribe" @status="value => message = value" />
      <label>音频文件<input type="file" accept="audio/*" :disabled="loading || busy || !recognition || recognitionDirty" @change="selectAudio"></label>
      <label v-if="transcript">识别结果<textarea v-model="transcript" maxlength="16000" /></label>
      <div v-if="transcript.trim()" class="actions">
        <button :disabled="busy" @click="emit('transcript', transcript)">将文字带到对话</button>
        <button :disabled="busy || !canTalk || !synthesis || synthesisDirty" @click="emit('talk', transcript)">发送并语音回复</button>
      </div>
      <p class="hint">“发送并语音回复”会开启本次应用运行期间的模型语音；主页可以随时关闭或停止说话。</p>
      <details>
        <summary>语音合成测试</summary>
        <p>文字发送到已保存的合成服务，只生成文件，不自动播放。</p>
        <textarea v-model="text" aria-label="语音测试文本" maxlength="2000" :disabled="busy" />
        <button :disabled="loading || busy || !synthesis || synthesisDirty || !text.trim()" @click="generate">生成语音文件</button>
        <a v-if="audioURL" :href="audioURL" :download="`anna-voice.${audioMime === 'audio/mpeg' ? 'mp3' : audioMime === 'audio/ogg' ? 'ogg' : audioMime === 'audio/flac' ? 'flac' : 'wav'}`">下载生成的语音</a>
      </details>
      <button v-if="active" @click="stop(); message = '语音请求已取消'">取消语音请求</button>
      <p role="status">{{ message }}</p>
    </section>
  </div>
</template>

<style scoped>
.voice-backdrop { position: fixed; inset: 0; z-index: 110; background: #0008; display: grid; place-items: center; }
.voice-sheet { width: min(580px, 92vw); max-height: 88vh; overflow: auto; padding: 24px; border-radius: 18px; background: #faf8f2; color: #34352f; }
header, .actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
h2 { margin: 0; }
p { line-height: 1.6; }
label { display: block; margin: 12px 0; }
textarea { display: block; box-sizing: border-box; width: 100%; min-height: 80px; padding: 10px; margin: 8px 0; }
button { margin: 4px 0; }
details { margin: 16px 0; }
summary { cursor: pointer; }
.hint { color: #65655f; font-size: 13px; }
a { display: inline-block; margin-left: 12px; }
</style>
