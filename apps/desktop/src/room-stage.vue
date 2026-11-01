<script setup lang="ts">
import type { Gesture } from '../../../packages/character/director'
import type { MotionCue } from '../../../packages/character/manifest'
import type { AnnaPhase, PermissionMode } from '../../../packages/shared/contracts'
import type { Anchors } from './character-stage.vue'
import { install } from '@pixi/unsafe-eval'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { Application, ShaderSystem, Ticker } from 'pixi.js'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { applyStance, approach, Director, gestureForModeChange, gestureOffset, poses, restingPose, stances } from '../../../packages/character/director'

const props = withDefaults(defineProps<{ phase: AnnaPhase, mode: PermissionMode, speaking: boolean, cue?: { kind: MotionCue, at: number } }>(), {})
const emit = defineEmits<{ poke: [], anchors: [anchors: Anchors] }>()
const element = ref<HTMLDivElement>()
const state = ref('loading')
const error = ref('')
const performed = ref<AnnaPhase>('offline')
const blink = ref(0)
const open = ref(0)
const playing = ref('')
let app: Application | undefined
let model: Live2DModel | undefined
let observer: ResizeObserver | undefined
let disposed = false
let frame = 0
let nextBlink = 0
let blinkAt = -1000
let cueAt = -1000
let pose = restingPose()
let gesture: Gesture | undefined
let gazeX = 0
let gazeY = 0
const pointer = { x: 0, y: 0 }
const director = new Director()
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
install({ ShaderSystem })
Live2DModel.registerTicker(Ticker)

function layout() {
  if (!app || !model || !element.value)
    return
  const { width, height } = element.value.getBoundingClientRect()
  app.renderer.resize(width, height)
  // The model canvas and room share the same cover transform. Anchor to the left so her face
  // remains visible on narrower windows; no model metadata or saved character settings change.
  const scale = Math.max(width / 1664, height / 941)
  model.scale.set(scale)
  model.position.set(0, (height - 941 * scale) / 2)
}

function track(event: PointerEvent) {
  if (!element.value)
    return
  const rect = element.value.getBoundingClientRect()
  pointer.x = Math.max(-1, Math.min(1, (event.clientX / rect.width - 0.35) * 2))
  pointer.y = Math.max(-1, Math.min(1, (event.clientY / rect.height - 0.35) * 2))
}

function perform() {
  if (!model)
    return
  const now = performance.now()
  const t = now / 1000
  performed.value = director.tick(now)
  pose = approach(pose, applyStance(poses[performed.value], stances[props.mode], performed.value), 0.065)
  const extra = gestureOffset(gesture, now)
  playing.value = extra ? gesture!.kind : ''
  const targetX = pose.followPointer ? pointer.x : pose.gazeX
  const targetY = pose.followPointer ? pointer.y : -pose.gazeY
  gazeX += (targetX - gazeX) * 0.065
  gazeY += (targetY - gazeY) * 0.065
  if (!reduced.matches && now >= nextBlink) {
    blinkAt = now
    nextBlink = now + 3000 + Math.random() * 3500
  }
  const blinkTime = (now - blinkAt) / 190
  blink.value = blinkTime >= 0 && blinkTime <= 1 ? Math.sin(blinkTime * Math.PI) : 0
  open.value += ((props.speaking ? 0.28 + Math.abs(Math.sin(t * 10.3)) * 0.66 : 0) - open.value) * 0.45
  const core = model.internalModel.coreModel as { setParameterValueById: (id: string, value: number) => void }
  const set = (id: string, value: number) => core.setParameterValueById(id, value)
  const moving = reduced.matches ? 0 : 1
  const greeting = Math.max(0, 1 - (now - cueAt) / 1800)
  set('ParamAngleX', (pose.headX + gazeX * 9 + (extra?.headX ?? 0)) * moving)
  set('ParamAngleY', (pose.headY - gazeY * 6 + greeting * Math.sin((now - cueAt) / 220) * 5 + (extra?.headY ?? 0)) * moving)
  set('ParamAngleZ', (pose.headZ + gazeX * 2 + Math.sin(t * 0.5) * 0.8 + (extra?.headZ ?? 0)) * moving)
  set('ParamBodyAngleX', pose.body * moving)
  set('ParamEyeBallX', gazeX)
  set('ParamEyeBallY', gazeY)
  // This artwork uses a closed-eyelid layer. Keep the neutral eyes fully open so a long
  // offline/thinking pose never leaves two expressions translucently superimposed.
  set('ParamEyeLOpen', 1 - blink.value)
  set('ParamEyeROpen', 1 - blink.value)
  set('ParamMouthOpenY', open.value)
  set('ParamMouthForm', pose.smile)
  set('ParamBrowLY', pose.brow)
  set('ParamBrowRY', pose.brow)
  set('ParamBreath', (0.5 + Math.sin(t * 1.35) * 0.5) * moving)
  set('ParamHairFront', Math.sin(t * 0.83) * 0.25 * moving)
  if (++frame % 8 === 0 && element.value) {
    const { width, height } = element.value.getBoundingClientRect()
    const scale = Math.max(width / 1664, height / 941)
    const y = (height - 941 * scale) / 2
    emit('anchors', { mouth: { x: 562 * scale, y: y + 382 * scale }, hand: { x: 1070 * scale, y: y + 850 * scale } })
  }
}

function poke() {
  cueAt = performance.now()
  blinkAt = cueAt
  emit('poke')
}

onMounted(async () => {
  app = new Application({ backgroundAlpha: 0, antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true })
  app.ticker.maxFPS = 45
  element.value!.appendChild(app.view)
  observer = new ResizeObserver(layout)
  observer.observe(element.value!)
  window.addEventListener('pointermove', track)
  director.update(props.phase, performance.now())
  nextBlink = performance.now() + 2200
  try {
    const loaded = await Live2DModel.from('./anna-room/anna.model3.json', { autoInteract: false, autoUpdate: true })
    if (disposed) {
      loaded.destroy({ children: true, texture: true, baseTexture: true })
      return
    }
    model = loaded
    model.internalModel.on('beforeModelUpdate', perform)
    app.stage.addChild(model)
    layout()
    state.value = 'ready'
  }
  catch (cause) {
    if (!disposed) {
      state.value = 'error'
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }
})
watch(() => props.phase, phase => director.update(phase, performance.now()))
watch(() => props.mode, (next, previous) => {
  if (next !== previous)
    gesture = { kind: gestureForModeChange(previous, next), start: performance.now() }
})
watch(() => props.cue?.at, () => { cueAt = performance.now() })
onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('pointermove', track)
  observer?.disconnect()
  model?.internalModel.off('beforeModelUpdate', perform)
  if (model) {
    app?.stage.removeChild(model)
    model.destroy({ children: true, texture: true, baseTexture: true })
  }
  model = undefined
  app?.destroy(true, { children: true })
  app = undefined
})
</script>

<template>
  <div ref="element" class="room-model model-canvas" :data-state="state" :data-mode="mode" :data-gesture="playing" :data-performed="performed" :data-mouth="open.toFixed(2)" :data-blink="blink.toFixed(2)" data-renderer="cubism">
    <p v-if="state === 'loading'" class="room-loading" role="status">Anna 正在醒来…</p>
    <p v-if="error" class="room-loading" role="alert">形象加载失败：{{ error }}。可切换原有外观继续使用。</p>
  </div>
  <button class="room-touch" aria-label="轻轻点一下 Anna，查看工作过程" @click="poke" />
</template>
