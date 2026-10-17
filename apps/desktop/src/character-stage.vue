<script setup lang="ts">
import type { Gesture } from '../../../packages/character/director'
import type { AnnaCharacter } from '../../../packages/character/manifest'
import type { AnnaPhase, PermissionMode } from '../../../packages/shared/contracts'
import { install } from '@pixi/unsafe-eval'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { Application, ShaderSystem, Ticker } from 'pixi.js'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { applyStance, approach, Director, gestureForModeChange, gestureOffset, poses, restingPose, stances } from '../../../packages/character/director'
import { fitStage } from '../../../packages/character/manifest'

const props = withDefaults(defineProps<{ character: AnnaCharacter, phase?: AnnaPhase, mode?: PermissionMode, speaking?: boolean, zoom?: number, align?: number }>(), { phase: 'idle', mode: 'edit', speaking: false, zoom: 1, align: 0.5 })
const emit = defineEmits<{ poke: [] }>()
const element = ref<HTMLDivElement>()
const state = ref('loading')
const error = ref('')
/** The phase actually being performed, after dwell and priority. Exposed for tests and styling. */
const performed = ref<AnnaPhase>('offline')
let app: Application | undefined
let model: Live2DModel | undefined
let observer: ResizeObserver | undefined
let generation = 0
let bounds = { width: 1, height: 1 }
const director = new Director()
let pose = restingPose()
let gesture: Gesture | undefined
/** The gesture being played, exposed for tests and styling. */
const playing = ref<string>('')
const pointer = { x: 0, y: 0 }
install({ ShaderSystem })
Live2DModel.registerTicker(Ticker)

interface Core { addParameterValueById: (id: string, value: number, weight?: number) => void, multiplyParameterValueById: (id: string, value: number, weight?: number) => void, setParameterValueById: (id: string, value: number, weight?: number) => void }

function layout() {
  if (!app || !model || !element.value)
    return
  const { width, height } = element.value.getBoundingClientRect()
  app.renderer.resize(width, height)
  const fit = fitStage(width, height, bounds.width, bounds.height, props.character.stage.scale * props.zoom)
  model.scale.set(fit.scale)
  // Zoomed framing keeps the head in the upper third and lets the legs leave the frame.
  const drop = (bounds.height * fit.scale - height) / 2
  model.position.set(width * props.align + props.character.stage.offsetX, fit.y + Math.max(0, drop) * 0.92 + props.character.stage.offsetY)
}

/** Layer the director's pose over the idle motion right before the model is evaluated. */
function perform() {
  if (!model)
    return
  const core = model.internalModel.coreModel as unknown as Core
  const now = performance.now()
  const t = now / 1000
  const tempo = stances[props.mode].tempo
  const extra = gestureOffset(gesture, now)
  playing.value = extra ? gesture!.kind : ''
  core.addParameterValueById('ParamAngleX', pose.headX + (extra?.headX ?? 0))
  core.addParameterValueById('ParamAngleY', pose.headY + Math.sin(t * 5.2 * tempo) * pose.bob + (extra?.headY ?? 0))
  core.addParameterValueById('ParamAngleZ', pose.headZ + (extra?.headZ ?? 0))
  core.addParameterValueById('ParamBodyAngleX', pose.body)
  core.addParameterValueById('ParamEyeBallX', Math.sin(t * 7) * pose.scan)
  const brow = pose.brow + (extra?.brow ?? 0)
  const smile = Math.max(-1, Math.min(1, pose.smile + (extra?.smile ?? 0)))
  for (const id of ['ParamBrowLY', 'ParamBrowRY'])
    core.addParameterValueById(id, brow)
  for (const id of ['ParamBrowLForm', 'ParamBrowRForm'])
    core.addParameterValueById(id, -Math.abs(brow) * 0.6 + Math.max(0, smile) * 0.3)
  core.setParameterValueById('ParamMouthForm', smile)
  for (const id of ['ParamEyeLSmile', 'ParamEyeRSmile'])
    core.setParameterValueById(id, Math.max(0, smile - 0.4))
  core.setParameterValueById('ParamCheek', Math.max(0, smile - 0.6))
  for (const id of ['ParamEyeLOpen', 'ParamEyeROpen'])
    core.multiplyParameterValueById(id, pose.eyeOpen)
  if (props.speaking)
    core.setParameterValueById('ParamMouthOpenY', 0.25 + Math.abs(Math.sin(t * 11)) * 0.45 + Math.sin(t * 23) * 0.08)
}

async function load() {
  const current = ++generation
  state.value = 'loading'
  error.value = ''
  if (model) { app?.stage.removeChild(model); model.destroy({ children: true, texture: true, baseTexture: true }); model = undefined }
  try {
    const loaded = await Live2DModel.from(props.character.modelPath, { autoInteract: false })
    if (current !== generation || !app) { loaded.destroy({ children: true, texture: true, baseTexture: true }); return }
    model = loaded
    bounds = { width: model.width, height: model.height }
    model.anchor.set(0.5)
    model.internalModel.on('beforeModelUpdate', perform)
    app.stage.addChild(model)
    layout()
    state.value = 'ready'
  }
  catch (cause) { if (current === generation) { state.value = 'error'; error.value = cause instanceof Error ? cause.message : String(cause) } }
}

function track(event: PointerEvent) {
  const rect = element.value?.getBoundingClientRect()
  if (!rect)
    return
  pointer.x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2))
  pointer.y = Math.max(-1, Math.min(1, -((event.clientY - rect.top) / rect.height - 0.35) * 2))
}

onMounted(() => {
  app = new Application({ backgroundAlpha: 0, antialias: true, resolution: Math.min(window.devicePixelRatio, 2), autoDensity: true })
  app.ticker.maxFPS = 45
  element.value!.appendChild(app.view)
  observer = new ResizeObserver(layout)
  observer.observe(element.value!)
  window.addEventListener('pointermove', track)
  director.update(props.phase, performance.now())
  app.ticker.add(() => {
    const now = performance.now()
    performed.value = director.tick(now)
    const stance = stances[props.mode]
    const target = applyStance(poses[performed.value], stance, performed.value)
    pose = approach(pose, target, 0.07 * stance.tempo)
    if (model) {
      const gaze = target.followPointer ? { x: pointer.x * 0.8, y: pointer.y * 0.6 } : { x: target.gazeX, y: target.gazeY }
      model.internalModel.focusController.focus(gaze.x, gaze.y)
    }
  })
  void load()
})
watch(() => props.phase, phase => director.update(phase, performance.now()))
watch(() => props.character.id, load)
watch(() => props.mode, (next, previous) => {
  if (previous && next !== previous)
    gesture = { kind: gestureForModeChange(previous, next), start: performance.now() }
})
watch(() => [props.zoom, props.align], layout)
onBeforeUnmount(() => { generation++; window.removeEventListener('pointermove', track); observer?.disconnect(); model?.destroy({ children: true, texture: true, baseTexture: true }); model = undefined; app?.destroy(true, { children: true }); app = undefined })
</script>

<template>
  <div ref="element" class="model-canvas" :data-character="character.id" :data-state="state" :data-performed="performed" :data-mode="mode" :data-gesture="playing" @click="emit('poke')">
    <p v-if="state === 'loading'" class="stage-loading" role="status">正在唤醒 {{ character.name }}…</p>
    <p v-if="error" class="stage-error" role="alert">模型加载失败：{{ error }}</p>
  </div>
</template>
