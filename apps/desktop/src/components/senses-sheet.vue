<script setup lang="ts">
import type { HearingModel } from '../../../../packages/senses/contracts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LocalHearing } from '../local-hearing'
import CapturePanel from './capture-panel.vue'
import ScreenPanel from './screen-panel.vue'
import VisionPanel from './vision-panel.vue'

defineEmits<{ close: [], transcript: [text: string] }>()
const message = ref('')
const hearing = new LocalHearing()
const metadataFile = ref<File>()
const modelFile = ref<File>()
const hearingBusy = ref(false)
const hearingReady = ref(false)
const savedModel = ref<HearingModel>()
const transcript = ref('')
const capturedFrame = ref('')
const frameSource = ref('摄像头单帧')
let hearingRevision = 0
let hearingImportId: string | undefined
let closed = false
function setFrame(image: string, source: string) { capturedFrame.value = image; frameSource.value = source }
function selected(event: Event) { return (event.target as HTMLInputElement).files?.[0] }
function stopHearing() {
  hearingRevision++
  hearing.stop()
  hearingReady.value = false
  hearingBusy.value = false
  if (hearingImportId) {
    void window.anna.senses({ type: 'cancel', id: hearingImportId }).catch(() => {})
    hearingImportId = undefined
  }
}
async function refreshHearing() {
  const current = hearingRevision
  try {
    const result = await window.anna.senses({ type: 'hearing-status' })
    if (!closed && current === hearingRevision && result.ok)
      savedModel.value = result.hearingModel
  }
  catch { /* The local import entry stays available if the core is still starting. */ }
}
async function importHearing() {
  stopHearing()
  const current = hearingRevision
  hearingImportId = crypto.randomUUID()
  hearingBusy.value = true
  message.value = '请选择对应的模型元数据和模型数据；导入后以后可离线加载。'
  try {
    const result = await window.anna.senses({ type: 'hearing-import', id: hearingImportId })
    if (current !== hearingRevision)
      return
    if (!result.ok) { message.value = result.error; return }
    savedModel.value = result.hearingModel
    message.value = '模型已保存在本机。点击加载后才能录音识别，不会自动开启麦克风。'
  }
  catch { if (current === hearingRevision) { message.value = '模型未导入，请稍后重试' } }
  finally { if (current === hearingRevision) { hearingBusy.value = false; hearingImportId = undefined } }
}
async function loadSavedHearing() {
  stopHearing()
  const current = hearingRevision
  hearingBusy.value = true
  try {
    await hearing.loadSaved(request => window.anna.senses(request), (percent) => {
      if (current === hearingRevision)
        message.value = `正在读取本机模型：${percent}%。读取后会校验并加载，不联网。`
    })
    if (current === hearingRevision) { hearingReady.value = true; message.value = '本地模型已就绪，可录音或选择预录音频识别' }
  }
  catch (cause) { if (current === hearingRevision) { message.value = cause instanceof Error ? cause.message : '模型加载失败' } }
  finally { if (current === hearingRevision) { hearingBusy.value = false } }
}
async function removeHearing() {
  stopHearing()
  const current = hearingRevision
  hearingBusy.value = true
  try {
    const result = await window.anna.senses({ type: 'hearing-remove' })
    if (current !== hearingRevision)
      return
    if (!result.ok) { message.value = result.error; return }
    savedModel.value = undefined
    message.value = 'Anna 保存的模型副本已删除，原始文件保留。'
  }
  catch { if (current === hearingRevision) { message.value = '模型未删除，请稍后重试' } }
  finally { if (current === hearingRevision) { hearingBusy.value = false } }
}
async function probeHearing() {
  const current = ++hearingRevision
  hearingBusy.value = true
  hearingReady.value = false
  message.value = '正在检查本机 WASM 识别运行时…'
  try {
    await hearing.probe(); if (current === hearingRevision)
      message.value = '本地识别运行时可用。仍需加载语音模型后才能识别。'
  }
  catch (cause) {
    if (current === hearingRevision)
      message.value = cause instanceof Error ? cause.message : '运行时无法启动'
  }
  finally {
    if (current === hearingRevision)
      hearingBusy.value = false
  }
}
async function loadHearing() {
  if (!metadataFile.value || !modelFile.value)
    return
  const current = ++hearingRevision
  hearingBusy.value = true
  hearingReady.value = false
  message.value = '正在本机加载模型，不录音、不联网识别…'
  try { await hearing.load(metadataFile.value, modelFile.value); if (current === hearingRevision) { hearingReady.value = true; message.value = '本地模型已就绪，可选择预录音频识别' } }
  catch (cause) {
    if (current === hearingRevision)
      message.value = cause instanceof Error ? cause.message : '模型加载失败'
  }
  finally {
    if (current === hearingRevision)
      hearingBusy.value = false
  }
}
async function recognizeFile(file: File) {
  const current = ++hearingRevision
  hearingBusy.value = true
  transcript.value = ''
  message.value = '本地识别中，不会播放音频…'
  try {
    const result = await hearing.transcribe(file)
    if (current === hearingRevision) { transcript.value = result; message.value = result ? '识别完成，请核对文字后再带到对话' : '没有识别出文字' }
  }
  catch (cause) { if (current === hearingRevision) { message.value = cause instanceof Error ? cause.message : '识别失败'; hearingReady.value = hearing.ready } }
  finally {
    if (current === hearingRevision)
      hearingBusy.value = false
  }
}
async function recognize(event: Event) {
  const file = selected(event)
  if (file)
    await recognizeFile(file)
  ;(event.target as HTMLInputElement).value = ''
}
const baseURL = ref('')
const model = ref('')
const voice = ref('')
const key = ref('')
const hasKey = ref(false)
const replaceKey = ref(false)
const voiceLoading = ref(true)
const voiceSaving = ref(false)
const voiceDirty = ref(false)
const voiceEndpoint = ref('')
watch([baseURL, model, voice, key, replaceKey], () => { voiceDirty.value = true }, { flush: 'sync' })
const text = ref('你好，我是 Anna。很高兴和你一起做事。')
const busy = ref(false)
const audioURL = ref('')
const audioMime = ref('audio/wav')
let active: string | undefined

function releaseAudio() {
  if (audioURL.value)
    URL.revokeObjectURL(audioURL.value)
  audioURL.value = ''
}
async function stop() {
  const id = active
  active = undefined
  busy.value = false
  if (id)
    await window.anna.senses({ type: 'cancel', id }).catch(() => {})
}
async function save() {
  if (voiceLoading.value || voiceSaving.value || busy.value)
    return
  voiceSaving.value = true
  message.value = ''
  try {
    const result = await window.anna.senses({ type: 'voice-configure', config: { baseURL: baseURL.value, model: model.value, voice: voice.value }, ...((key.value || replaceKey.value) ? { key: key.value } : {}) })
    if (closed)
      return
    if (!result.ok) { message.value = result.error; return }
    hasKey.value = Boolean(result.hasKey)
    key.value = ''
    replaceKey.value = false
    voiceEndpoint.value = result.config?.baseURL ?? ''
    voiceDirty.value = false
    message.value = '配置已保存。生成试听会调用所填服务，可能消耗额度；不会自动播放。'
    releaseAudio()
  }
  catch { message.value = '配置未保存，请稍后重试' }
  finally { voiceSaving.value = false }
}
async function generate() {
  if (closed || voiceLoading.value || voiceSaving.value || voiceDirty.value || !voiceEndpoint.value || busy.value)
    return
  await stop()
  if (closed)
    return
  releaseAudio()
  const id = crypto.randomUUID()
  active = id
  busy.value = true
  message.value = '正在生成音频，不会外放…'
  try {
    const result = await window.anna.senses({ type: 'voice-generate', id, text: text.value })
    if (closed || active !== id)
      return
    if (!result.ok) { message.value = result.error; return }
    if (!result.audio)
      throw new Error('缺少音频')
    const bytes = Uint8Array.from(atob(result.audio.base64), c => c.charCodeAt(0))
    audioMime.value = result.audio.mime
    audioURL.value = URL.createObjectURL(new Blob([bytes], { type: result.audio.mime }))
    message.value = `音频已生成（${Math.round(bytes.length / 1024)} KB）。可下载后在方便时试听，当前保持静音。`
  }
  catch {
    if (!closed && active === id)
      message.value = '语音生成失败，请检查服务配置'
  }
  finally { if (active === id) { active = undefined; busy.value = false } }
}
onMounted(async () => {
  try {
    const result = await window.anna.senses({ type: 'voice-status' })
    if (closed)
      return
    if (!result.ok) { message.value = result.error; return }
    if (result.config) {
      baseURL.value = result.config.baseURL
      model.value = result.config.model
      voice.value = result.config.voice
    }
    hasKey.value = Boolean(result.hasKey)
    voiceEndpoint.value = result.config?.baseURL ?? ''
    voiceDirty.value = false
  }
  catch { message.value = '感官服务未连接，请稍后重试' }
  finally { voiceLoading.value = false }
})
onMounted(() => { void refreshHearing() })
onBeforeUnmount(() => { closed = true; stopHearing(); void stop(); releaseAudio() })
</script>

<template>
  <div class="senses-backdrop" @click.self="$emit('close')">
    <section class="senses-sheet" role="dialog" aria-modal="true" aria-label="Anna 感官">
      <header><h2>Anna 的感官</h2><button @click="$emit('close')">关闭</button></header>
      <p>声音由你选择的模型生成，不使用系统朗读。当前为静音开发模式。</p>
      <p>主页明确开启“模型语音”后，桌面任务的完整回复会分段调用所保存的语音服务并播放，可能产生费用。每次启动默认关闭；静音生成测试只生成文件。</p>
      <p>可在本机识别预录音频。设备仅在你明确开启后使用。</p>
      <h3>本地听觉 · 中英文 Paraformer</h3>
      <p>首次需要模型包：preload.js.metadata 和对应 preload.data。导入后保存在本机，以后无需重复选择；识别不上传音频。文件格式、来源与许可请在下载前核对。</p>
      <p><a href="https://huggingface.co/moeru-ai/sherpaw-paraformer-zh-en/tree/46701cc733a82ed5cb94c7f3200a002d010243f6/install/bin/wasm" target="_blank" rel="noopener noreferrer">查看 AIRI 使用的模型文件</a>。当前网络可能无法访问，可从能访问的电脑下载后传入；不要运行模型包中的脚本。</p>
      <button :disabled="hearingBusy" @click="importHearing">导入并保存本地模型包</button>
      <p v-if="savedModel">已保存模型：{{ Math.round(savedModel.size / 1024 / 1024) }} MB · 校验 {{ savedModel.sha256.slice(0, 12) }}</p>
      <button v-if="savedModel" :disabled="hearingBusy" @click="loadSavedHearing">加载已保存的本地模型</button>
      <button v-if="savedModel" :disabled="hearingBusy" @click="removeHearing">删除 Anna 的模型副本</button>
      <button :disabled="hearingBusy" @click="probeHearing">检查本地识别运行时</button>
      <details>
        <summary>高级：只在本次窗口临时加载</summary>
        <p>临时模型不会保存，关闭面板后释放。</p>
        <label>模型元数据<input type="file" accept=".metadata,.json" :disabled="hearingBusy" @change="metadataFile = selected($event)"></label>
        <label>模型数据<input type="file" accept=".data" :disabled="hearingBusy" @change="modelFile = selected($event)"></label>
        <button :disabled="hearingBusy || !metadataFile || !modelFile" @click="loadHearing">加载本地识别模型</button>
      </details>
      <button v-if="hearingBusy || hearingReady" @click="stopHearing">停止识别并释放模型</button>
      <label>预录音频<input type="file" accept="audio/*" :disabled="!hearingReady || hearingBusy" @change="recognize"></label>
      <textarea v-if="transcript" v-model="transcript" aria-label="识别结果" />
      <button v-if="transcript" @click="$emit('transcript', transcript)">将文字带到对话</button>
      <CapturePanel :hearing-ready="hearingReady" :disabled="hearingBusy" @recording="recognizeFile" @frame="setFrame" @status="text => message = text" />
      <ScreenPanel @frame="setFrame" />
      <VisionPanel :image="capturedFrame" :source="frameSource" @clear="capturedFrame = ''" @observation="text => $emit('transcript', text)" />
      <form @submit.prevent="save">
        <h3>语音服务</h3>
        <p>填写支持 /audio/speech 的兼容服务，地址包含服务要求的版本前缀（如 /v1）。模型与音色请从该服务商的控制台获取。本机服务可以不填密钥。</p>
        <label>服务地址<input v-model="baseURL" type="url" placeholder="https://服务地址/v1" required :disabled="busy || voiceLoading || voiceSaving"></label>
        <label>语音模型<input v-model="model" required maxlength="200" :disabled="busy || voiceLoading || voiceSaving"></label>
        <label>音色 ID<input v-model="voice" required maxlength="200" :disabled="busy || voiceLoading || voiceSaving"></label>
        <label>API Key<input v-model="key" type="password" autocomplete="new-password" :placeholder="hasKey ? '已保存，留空保留' : '本机服务可留空'" :disabled="busy || voiceLoading || voiceSaving"></label>
        <label><input v-model="replaceKey" type="checkbox" :disabled="busy || voiceLoading || voiceSaving">替换已保存密钥（输入框为空则清除）</label>
        <button :disabled="busy || voiceLoading || voiceSaving">保存语音配置</button>
      </form>
      <h3>静音生成测试</h3>
      <p>文本会发送给上面保存的语音服务，可能产生费用。只生成文件，不自动播放。</p>
      <p v-if="voiceEndpoint">语音发送目标：{{ voiceEndpoint }}</p>
      <p v-if="voiceDirty">语音配置已改动，请先保存再生成。</p>
      <textarea v-model="text" aria-label="语音测试文本" maxlength="2000" :disabled="busy" />
      <button :disabled="busy || voiceLoading || voiceSaving || voiceDirty || !voiceEndpoint || !text.trim()" @click="generate">生成语音文件</button>
      <button v-if="busy" @click="stop">取消生成</button>
      <p role="status">{{ message }}</p>
      <a v-if="audioURL" :href="audioURL" :download="`anna-voice.${audioMime === 'audio/mpeg' ? 'mp3' : audioMime === 'audio/ogg' ? 'ogg' : audioMime === 'audio/flac' ? 'flac' : 'wav'}`">下载生成的语音</a>
    </section>
  </div>
</template>

<style scoped>
.senses-backdrop { position: fixed; inset: 0; z-index: 110; background: #0008; display: grid; place-items: center; }
.senses-sheet { width: min(620px, 92vw); max-height: 90vh; overflow: auto; padding: 24px; border-radius: 18px; background: #faf8f2; color: #34352f; }
header { display: flex; align-items: center; justify-content: space-between; }
label { display: block; margin: 12px 0; }
input:not([type="checkbox"]), textarea { display: block; width: 100%; box-sizing: border-box; margin-top: 5px; padding: 8px; }
textarea { min-height: 90px; }
p { line-height: 1.6; }
button { margin: 4px; }
</style>
