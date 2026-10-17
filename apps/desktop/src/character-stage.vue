<script setup lang="ts">
import type { Gesture } from '../../../packages/character/director'
import type { AnnaCharacter, MotionCue } from '../../../packages/character/manifest'
import type { AnnaPhase, PermissionMode } from '../../../packages/shared/contracts'
import { install } from '@pixi/unsafe-eval'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { Application, Point, ShaderSystem, Ticker } from 'pixi.js'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { applyStance, approach, Director, gestureForModeChange, gestureOffset, poses, restingPose, stances } from '../../../packages/character/director'
import { fitStage, paramId } from '../../../packages/character/manifest'

export interface Anchors { mouth?: { x: number, y: number }, hand?: { x: number, y: number } }
const props = withDefaults(defineProps<{ character: AnnaCharacter, phase?: AnnaPhase, mode?: PermissionMode, speaking?: boolean, zoom?: number, align?: number, cue?: { kind: MotionCue, at: number }, reach?: number }>(), { phase: 'idle', mode: 'edit', speaking: false, zoom: 1, align: 0.5, reach: 0 })
/** `anchors` reports where her mouth and her outward hand are on screen (viewport pixels), a few times a second. */
const emit = defineEmits<{ poke: [], anchors: [anchors: Anchors] }>()
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

interface Core { addParameterValueById: (id: string, value: number, weight?: number) => void, multiplyParameterValueById: (id: string, value: number, weight?: number) => void, setParameterValueById: (id: string, value: number, weight?: number) => void, getDrawableOpacity: (index: number) => number, _model: { parts: { ids: string[], parentIndices: Int32Array }, drawables: { count: number, parentPartIndices: Int32Array } } }
interface Internal { getDrawableVertices: (index: number) => Float32Array, localTransform: { apply: (point: Point, out?: Point) => Point }, originalWidth: number, originalHeight: number }

/** Drawables whose part, or any ancestor part, has an ID matching `pattern` (e.g. PartMouth, PARTS_01_ARM_R_A). */
function drawablesOf(core: Core, pattern: RegExp) {
  const { parts, drawables } = core._model
  const matches = (part: number): boolean => part >= 0 && (pattern.test(parts.ids[part] ?? '') || matches(parts.parentIndices[part] ?? -1))
  const out: number[] = []
  for (let index = 0; index < drawables.count; index++) {
    if (matches(drawables.parentPartIndices[index] ?? -1))
      out.push(index)
  }
  return out
}
let mouthDrawables: number[] = []
let armDrawables: number[] = []
let handDrawables: number[] = []
let anchorFrame = 0

function layout() {
  if (!app || !model || !element.value)
    return
  const { width: canvasWidth, height } = element.value.getBoundingClientRect()
  app.renderer.resize(canvasWidth, height)
  // The canvas reaches `reach` pixels past the stage so an outstretched arm is not cut off; framing ignores it.
  const width = canvasWidth - props.reach
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
  const id = (name: string) => paramId(props.character, name)
  const now = performance.now()
  const t = now / 1000
  const tempo = stances[props.mode].tempo
  const extra = gestureOffset(gesture, now)
  playing.value = extra ? gesture!.kind : ''
  core.addParameterValueById(id('ParamAngleX'), pose.headX + (extra?.headX ?? 0))
  core.addParameterValueById(id('ParamAngleY'), pose.headY + Math.sin(t * 5.2 * tempo) * pose.bob + (extra?.headY ?? 0))
  core.addParameterValueById(id('ParamAngleZ'), pose.headZ + (extra?.headZ ?? 0))
  core.addParameterValueById(id('ParamBodyAngleX'), pose.body)
  core.addParameterValueById(id('ParamEyeBallX'), Math.sin(t * 7) * pose.scan)
  const brow = pose.brow + (extra?.brow ?? 0)
  const smile = Math.max(-1, Math.min(1, pose.smile + (extra?.smile ?? 0)))
  for (const name of ['ParamBrowLY', 'ParamBrowRY'])
    core.addParameterValueById(id(name), brow)
  for (const name of ['ParamBrowLForm', 'ParamBrowRForm'])
    core.addParameterValueById(id(name), -Math.abs(brow) * 0.6 + Math.max(0, smile) * 0.3)
  core.setParameterValueById(id('ParamMouthForm'), smile)
  for (const name of ['ParamEyeLSmile', 'ParamEyeRSmile'])
    core.setParameterValueById(id(name), Math.max(0, smile - 0.4))
  core.setParameterValueById(id('ParamCheek'), Math.max(0, smile - 0.6))
  for (const name of ['ParamEyeLOpen', 'ParamEyeROpen'])
    core.multiplyParameterValueById(id(name), pose.eyeOpen)
  if (props.speaking)
    core.setParameterValueById(id('ParamMouthOpenY'), 0.25 + Math.abs(Math.sin(t * 11)) * 0.45 + Math.sin(t * 23) * 0.08)
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
    const core = model.internalModel.coreModel as unknown as Core
    mouthDrawables = drawablesOf(core, /mouth/i)
    armDrawables = drawablesOf(core, /arm/i)
    handDrawables = drawablesOf(core, /hand|glove/i)
    app.stage.addChild(model)
    layout()
    state.value = 'ready'
  }
  catch (cause) { if (current === generation) { state.value = 'error'; error.value = cause instanceof Error ? cause.message : String(cause) } }
}

/** Her mouth (centre of the visible mouth meshes) and the hand on the side facing the cards (lowest visible arm point). */
function measureAnchors() {
  if (!model || !element.value)
    return
  const core = model.internalModel.coreModel as unknown as Core
  const internal = model.internalModel as unknown as Internal
  const rect = element.value.getBoundingClientRect()
  const toViewport = (x: number, y: number) => {
    const global = model!.toGlobal(internal.localTransform.apply(new Point(x, y)))
    return { x: rect.left + global.x, y: rect.top + Math.min(global.y, rect.height - 24) }
  }
  const visible = (index: number) => core.getDrawableOpacity(index) > 0.2
  let mouth: Anchors['mouth']
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const index of mouthDrawables.filter(visible)) {
    const vertices = internal.getDrawableVertices(index)
    for (let k = 0; k < vertices.length; k += 2) {
      x0 = Math.min(x0, vertices[k]!)
      x1 = Math.max(x1, vertices[k]!)
      y0 = Math.min(y0, vertices[k + 1]!)
      y1 = Math.max(y1, vertices[k + 1]!)
    }
  }
  if (Number.isFinite(x0))
    mouth = toViewport((x0 + x1) / 2, (y0 + y1) / 2)
  // The cards sit to her right on screen, which is the model's left side: the larger x half of the canvas.
  // Her hand is the outward point farthest from the shoulder, whether the arm hangs down or reaches out.
  const centre = internal.originalWidth / 2
  const shoulder = { x: centre, y: internal.originalHeight * 0.3 }
  const farthest = (indices: number[]) => {
    let best: { x: number, y: number, d: number } | undefined
    for (const index of indices.filter(visible)) {
      const vertices = internal.getDrawableVertices(index)
      for (let k = 0; k < vertices.length; k += 2) {
        const x = vertices[k]!
        const y = vertices[k + 1]!
        const d = (x - shoulder.x) ** 2 + (y - shoulder.y) ** 2
        if (x > centre && (!best || d > best.d))
          best = { x, y, d }
      }
    }
    return best
  }
  const hand = farthest(handDrawables) ?? farthest(armDrawables)
  emit('anchors', { mouth, hand: hand && toViewport(hand.x, hand.y) })
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
      if (++anchorFrame % 6 === 0)
        measureAnchors()
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
/** Play the model's own motion for a moment on stage; models without one get a nod. */
watch(() => props.cue?.at, () => {
  const cue = props.cue
  if (!cue || !model)
    return
  const motion = (props.character.motions as AnnaCharacter['motions'])?.[cue.kind]
  if (motion)
    void model.motion(motion[0], motion[1], 3)
  else
    gesture = { kind: 'nod', start: performance.now() }
})
onBeforeUnmount(() => { generation++; window.removeEventListener('pointermove', track); observer?.disconnect(); model?.destroy({ children: true, texture: true, baseTexture: true }); model = undefined; app?.destroy(true, { children: true }); app = undefined })
</script>

<template>
  <div ref="element" class="model-canvas" :data-character="character.id" :data-state="state" :data-performed="performed" :data-mode="mode" :data-gesture="playing" :style="{ right: `${-reach}px` }" @click="event => event.offsetX < (element?.clientWidth ?? 0) - reach && emit('poke')">
    <p v-if="state === 'loading'" class="stage-loading" role="status">正在唤醒 {{ character.name }}…</p>
    <p v-if="error" class="stage-error" role="alert">模型加载失败：{{ error }}</p>
  </div>
</template>
