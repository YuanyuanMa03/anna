<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { cameraFrame, MediaSession } from '../media-session'

const props = defineProps<{ hearingReady: boolean, disabled: boolean }>()
const emit = defineEmits<{ recording: [file: File], frame: [image: string, source: string], status: [text: string] }>()
const camera = ref<HTMLVideoElement>()
const cameraActive = ref(false)
const recording = ref(false)
const requesting = ref(false)
let closed = false
let recorder: MediaRecorder | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let cancelRecording = false
let recordingRevision = 0
let cameraRevision = 0
const mic = new MediaSession(navigator.mediaDevices, () => stopRecording(false))
const vision = new MediaSession(navigator.mediaDevices, () => stopCamera())
function stopCamera() {
  cameraRevision++
  vision.stop()
  cameraActive.value = false
  if (camera.value)
    camera.value.srcObject = null
}
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
  requesting.value = false
}
async function startRecording() {
  if (!props.hearingReady || props.disabled || requesting.value || recording.value)
    return
  const revision = ++recordingRevision
  requesting.value = true
  cancelRecording = false
  emit('status', '正在申请麦克风权限；录音只用于本机识别。')
  try {
    const stream = await mic.open('microphone')
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
    emit('status', '正在录音。点击“结束并识别”后只在本机识别，不自动发送。')
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
      requesting.value = false
  }
}
async function startCamera() {
  if (requesting.value || props.disabled)
    return
  requesting.value = true
  const revision = ++cameraRevision
  emit('status', '正在申请摄像头权限，只显示本机预览。')
  try {
    const stream = await vision.open('camera')
    if (closed || revision !== cameraRevision)
      return
    cameraActive.value = true
    await nextTick()
    if (closed || revision !== cameraRevision || !camera.value)
      return
    camera.value.srcObject = stream
    await camera.value.play()
  }
  catch {
    if (revision === cameraRevision) {
      stopCamera()
      requesting.value = false
      if (!closed)
        emit('status', '摄像头未开启，请检查权限及设备')
    }
  }
  finally {
    if (revision === cameraRevision)
      requesting.value = false
  }
}
function capture() {
  try {
    if (!camera.value)
      return
    emit('frame', cameraFrame(camera.value), '摄像头单帧')
    emit('status', '已取一帧，尚未发送给模型。关闭摄像头可停止预览。')
  }
  catch (cause) { emit('status', cause instanceof Error ? cause.message : '取帧失败') }
}
watch(() => props.hearingReady, (ready) => {
  if (!ready)
    stopRecording()
})
watch(() => props.disabled, (disabled) => {
  if (disabled)
    stopRecording()
})
onBeforeUnmount(() => { closed = true; stopRecording(); stopCamera() })
</script>

<template>
  <section aria-label="感官设备">
    <h3>麦克风与摄像头</h3>
    <p>默认关闭。仅点击开启时申请权限，关闭面板会释放设备。麦克风需要先加载本地识别模型。</p>
    <button :disabled="disabled || !hearingReady || requesting || recording" @click="startRecording">开启麦克风录音</button>
    <button v-if="recording" @click="stopRecording(false)">结束并识别</button>
    <button v-if="recording || requesting" @click="stopRecording(); stopCamera()">取消设备操作</button>
    <button :disabled="disabled || requesting || cameraActive" @click="startCamera">开启摄像头预览</button>
    <button v-if="cameraActive" @click="stopCamera">关闭摄像头</button>
    <video v-if="cameraActive" ref="camera" muted playsinline aria-label="摄像头本机预览" style="width: 100%; max-height: 240px" />
    <button v-if="cameraActive" @click="capture">取一帧供 Anna 查看</button>
  </section>
</template>
