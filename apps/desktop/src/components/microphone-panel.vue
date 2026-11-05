<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { MediaSession } from '../media-session'

const props = defineProps<{ ready: boolean, disabled: boolean, local: boolean }>()
const emit = defineEmits<{ recording: [file: File], status: [text: string] }>()
const recording = ref(false)
const microphoneRequesting = ref(false)
const requesting = microphoneRequesting
let closed = false
let recorder: MediaRecorder | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let cancelRecording = false
let recordingRevision = 0
const mic = new MediaSession(navigator.mediaDevices, () => stopRecording(false))
function stopRecording(discard = true) {
  cancelRecording = discard
  if (discard)
    recordingRevision++
  if (timer)
    clearTimeout(timer)
  timer = undefined
  if (recorder && recorder.state !== 'inactive')
    recorder.stop()
  mic.stop()
  recording.value = false
  microphoneRequesting.value = false
}
async function startRecording() {
  if (!props.ready || props.disabled || requesting.value || recording.value)
    return
  const revision = ++recordingRevision
  microphoneRequesting.value = true
  cancelRecording = false
  emit('status', '正在申请麦克风权限…')
  try {
    const stream = await mic.open()
    if (closed || revision !== recordingRevision)
      return
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type))
    const current = new MediaRecorder(stream, mimeType ? { mimeType } : {})
    recorder = current
    const chunks: Blob[] = []
    let size = 0
    current.ondataavailable = ({ data }) => {
      if (recorder !== current || revision !== recordingRevision)
        return
      size += data.size
      if (size > 20 * 1024 * 1024) { stopRecording(); emit('status', '录音过大，已停止并丢弃'); return }
      if (data.size)
        chunks.push(data)
    }
    current.onerror = () => {
      if (recorder === current && revision === recordingRevision) { stopRecording(); emit('status', '录音失败，请检查输入设备') }
    }
    current.onstop = () => {
      if (recorder !== current)
        return
      recorder = undefined
      mic.stop()
      recording.value = false
      if (!closed && !cancelRecording && revision === recordingRevision && chunks.length)
        emit('recording', new File(chunks, 'anna-recording', { type: current.mimeType }))
    }
    current.start(250)
    recording.value = true
    timer = setTimeout(() => stopRecording(false), 120000)
    emit('status', `正在录音。点击“结束并识别”后交给${props.local ? '本地服务' : '云端 API'}，请核对识别文字。`)
  }
  catch {
    if (revision === recordingRevision) {
      mic.stop()
      if (!closed)
        emit('status', '麦克风未开启，可能是权限被拒绝、设备不可用或操作已取消')
    }
  }
  finally {
    if (revision === recordingRevision)
      microphoneRequesting.value = false
  }
}
watch(() => props.ready, (ready) => {
  if (!ready)
    stopRecording()
})
watch(() => props.disabled, (disabled) => {
  if (disabled)
    stopRecording()
})
onBeforeUnmount(() => { closed = true; stopRecording() })
</script>

<template>
  <section aria-label="麦克风录音">
    <p>点击后开启麦克风，最长录音两分钟。关闭面板会停止录音。</p>
    <button :disabled="disabled || !ready || requesting || recording" @click="startRecording">开启麦克风录音</button>
    <button v-if="recording" @click="stopRecording(false)">结束并识别</button>
    <button v-if="recording || requesting" @click="stopRecording()">取消录音</button>
  </section>
</template>
