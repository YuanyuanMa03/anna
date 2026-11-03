<script setup lang="ts">
import type { ScreenSource } from '../../../../packages/senses/contracts'
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { cameraFrame, MediaSession } from '../media-session'

const emit = defineEmits<{ frame: [image: string, source: string] }>()
const sources = ref<ScreenSource[]>([])
const selected = ref('')
const active = ref('')
const preview = ref<HTMLVideoElement>()
const busy = ref(false)
const status = ref('')
let revision = 0
let closed = false
const media = new MediaSession(navigator.mediaDevices, () => stop())
function stop() {
  revision++
  media.stop()
  active.value = ''
  sources.value = []
  selected.value = ''
  busy.value = false
  if (preview.value)
    preview.value.srcObject = null
  void window.anna.senses({ type: 'screen-clear' }).catch(() => {})
}
async function list() {
  stop()
  const current = revision
  sources.value = []
  selected.value = ''
  busy.value = true
  status.value = '正在获取可共享的窗口列表，尚未开始共享。'
  try {
    const result = await window.anna.senses({ type: 'screen-sources' })
    if (closed || current !== revision)
      return
    if (!result.ok) { status.value = result.error; return }
    sources.value = result.sources ?? []
    status.value = sources.value.length ? '请选择一个来源，然后开启本机预览。' : '未找到可共享窗口；请检查系统屏幕录制权限，Linux Wayland 也可能需要桌面门户支持。'
  }
  catch {
    if (!closed && current === revision)
      status.value = '无法列出窗口，请检查系统屏幕录制权限'
  }
  finally {
    if (current === revision)
      busy.value = false
  }
}
async function start() {
  if (!selected.value || busy.value)
    return
  const current = ++revision
  busy.value = true
  try {
    const result = await window.anna.senses({ type: 'screen-select', id: selected.value })
    if (closed || current !== revision)
      return
    if (!result.ok) { status.value = result.error; return }
    const stream = await media.open('screen')
    if (closed || current !== revision)
      return
    active.value = sources.value.find(source => source.id === selected.value)?.name ?? '用户选择的窗口'
    await nextTick()
    if (!preview.value || closed || current !== revision)
      return
    preview.value.srcObject = stream
    await preview.value.play()
    status.value = '正在本机预览，不采集声音，也不会自动上传画面。'
  }
  catch { if (!closed && current === revision) { stop(); status.value = '屏幕共享未开启，可能已取消、来源关闭或系统权限不足' } }
  finally {
    if (current === revision)
      busy.value = false
  }
}
function capture() {
  try {
    if (preview.value)
      emit('frame', cameraFrame(preview.value), `共享窗口：${active.value}`.slice(0, 200))
  }
  catch (error) { status.value = error instanceof Error ? error.message : '画面尚未就绪' }
}
onBeforeUnmount(() => { closed = true; stop(); sources.value = [] })
</script>

<template>
  <section aria-label="屏幕感知">
    <h3>看你选择的窗口</h3>
    <p>获取列表会读取窗口名称和缩略图。选择后只在本机预览，点击取帧后还需明确发送给视觉模型。</p>
    <button :disabled="busy || Boolean(active)" @click="list">获取可共享窗口</button>
    <fieldset v-if="sources.length && !active" :disabled="busy">
      <legend>选择窗口或屏幕</legend>
      <label v-for="source in sources" :key="source.id" style="display: block">
        <input v-model="selected" type="radio" name="anna-screen" :value="source.id">{{ source.name }}
        <img v-if="source.thumbnail" :src="source.thumbnail" alt="" style="width: 160px">
      </label>
      <button :disabled="!selected || busy" @click="start">预览所选窗口</button>
    </fieldset>
    <video v-if="active" ref="preview" muted playsinline aria-label="共享窗口本机预览" style="width: 100%; max-height: 240px" />
    <button v-if="active" @click="capture">取共享窗口的一帧</button>
    <button v-if="active || busy" @click="stop">停止屏幕共享</button>
    <p role="status">{{ status }}</p>
  </section>
</template>
