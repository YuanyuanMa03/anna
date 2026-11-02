<script setup lang="ts">
import type { AvatarPackage, MeshAvatar } from 'mesh-avatar'
import type { BodyExpression, BodyRegions } from '../../../packages/character/body'
import type { Companion, MotionCue } from '../../../packages/character/manifest'
import type { AnnaPhase, PermissionMode } from '../../../packages/shared/contracts'
import type { Anchors } from './character-stage.vue'
import { loadMeshAvatar, openAvatar } from 'mesh-avatar'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { aim, BodyDirector, bodyRegions, frameBody, headPoint, regionAt, voiceAt } from '../../../packages/character/body'
import { followBodyLook, stabilizeBodyRig } from '../../../packages/character/body-rig'
import { Director, gestureForModeChange } from '../../../packages/character/director'

const props = withDefaults(defineProps<{ body: Pick<NonNullable<Companion['body']>, 'crop' | 'hands'> & { path?: string, archive?: Blob }, name: string, phase?: AnnaPhase, mode?: PermissionMode, speaking?: boolean, listening?: boolean, align?: number, cue?: { kind: MotionCue, at: number } }>(), { phase: 'idle', mode: 'edit', speaking: false, listening: false, align: 0.5 })
/** `anchors` reports her mouth and the hand she holds things in (viewport pixels). `unavailable` says why the body cannot be shown. */
const emit = defineEmits<{ poke: [], anchors: [anchors: Anchors], unavailable: [reason: string] }>()
const element = ref<HTMLDivElement>()
const canvas = ref<HTMLCanvasElement>()
const state = ref('loading')
/** The phase actually being performed, the mode gesture, the runtime motion and the face: exposed for tests and styling. */
const performed = ref<AnnaPhase>('offline')
const playing = ref('')
const motion = ref('')
const expression = ref<BodyExpression>('neutral')
const placement = ref({ scale: 0, left: 0, top: 0, width: 0, height: 0 })
const director = new Director()
const bodyDirector = new BodyDirector()
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
let avatar: MeshAvatar | undefined
let avatarPackage: AvatarPackage | undefined
let image = { width: 1, height: 1 }
let mouth = { x: 0, y: 0 }
let head: AvatarPackage['rig']['head'] | undefined
let gazeCentre = { x: 0, y: 0 }
let regions: BodyRegions | undefined
/** Her drawn outline at a quarter of the image size: only opaque pixels can be touched. */
let silhouette: { alpha: Uint8ClampedArray, width: number, height: number } | undefined
const silhouetteStep = 4
let observer: ResizeObserver | undefined
let frame = 0
let disposed = false
let gestureUntil = 0
let talking = false
let talkStart = 0
let weight = 0
const look = { gazeX: 0, gazeY: 0, angleX: 0, angleY: 0, angleZ: 0 }
const pointer = { x: 0, y: 0, at: performance.now() }
let activeAt = performance.now()
let lastFrameAt = performance.now()
let pokeTimer: number | undefined

function layout() {
  if (!element.value)
    return
  const box = element.value.getBoundingClientRect()
  // Her arms rest just above the stage's status ribbon, so it never covers her hands.
  const ribbon = element.value.parentElement?.querySelector('.status-ribbon')?.getBoundingClientRect()
  const fit = frameBody({ width: box.width, height: box.height }, props.body.crop, props.align, ribbon ? Math.max(0, box.bottom - ribbon.top + 6) : 0)
  placement.value = { ...fit, width: image.width * fit.scale, height: image.height * fit.scale }
}

/** Image pixels to stage pixels, and a stage point back to image pixels. */
const toStage = (x: number, y: number) => ({ x: placement.value.left + x * placement.value.scale, y: placement.value.top + y * placement.value.scale })
const toImage = (x: number, y: number) => ({ x: (x - placement.value.left) / placement.value.scale, y: (y - placement.value.top) / placement.value.scale })
/** The part of her under a stage point, if the point is on her drawn outline at all. */
function touched(x: number, y: number) {
  if (!regions || !placement.value.scale)
    return undefined
  const point = toImage(x, y)
  if (silhouette) {
    const column = Math.floor(point.x / silhouetteStep)
    const row = Math.floor(point.y / silhouetteStep)
    if (column < 0 || row < 0 || column >= silhouette.width || row >= silhouette.height || silhouette.alpha[(row * silhouette.width + column) * 4 + 3]! < 32)
      return undefined
  }
  return regionAt(regions, point)
}
async function traceSilhouette(url: string) {
  const picture = new Image()
  picture.src = url
  await picture.decode()
  const width = Math.ceil(image.width / silhouetteStep)
  const height = Math.ceil(image.height / silhouetteStep)
  const context = new OffscreenCanvas(width, height).getContext('2d')!
  context.drawImage(picture, 0, 0, width, height)
  silhouette = { alpha: context.getImageData(0, 0, width, height).data, width, height }
}

function track(event: PointerEvent) {
  const rect = element.value?.getBoundingClientRect()
  if (!rect)
    return
  pointer.x = event.clientX - rect.left
  pointer.y = event.clientY - rect.top
  pointer.at = activeAt = performance.now()
  // Her outline, not the empty canvas around her, is what can be touched.
  element.value!.style.cursor = touched(pointer.x, pointer.y) ? 'pointer' : 'default'
}
/** Typing, or coming back to the window (animation frames pause while it is hidden), counts as being with her. */
function stir() { activeAt = performance.now() }
function returned() {
  if (document.visibilityState === 'visible')
    stir()
}

function touch(event: MouseEvent, double: boolean) {
  const rect = element.value?.getBoundingClientRect()
  const region = rect && touched(event.clientX - rect.left, event.clientY - rect.top)
  if (!region)
    return
  activeAt = performance.now()
  bodyDirector.touch(region, activeAt, double)
  // Her face and hair get a personal reaction; her hands and body hold the work, and a click there opens it,
  // as a click on the Live2D stage does. It waits out a double click, which is a wink and opens nothing.
  window.clearTimeout(pokeTimer)
  if ((region === 'hands' || region === 'body') && !double)
    pokeTimer = window.setTimeout(() => emit('poke'), 450)
}

function tick() {
  if (!avatar || disposed)
    return
  const now = performance.now()
  performed.value = director.tick(now)
  const next = bodyDirector.frame(performed.value, now, { pointerAt: pointer.at, activeAt, listening: props.listening })
  if (next.motion && !reduced.matches)
    avatar.play(next.motion)
  if (next.expression !== expression.value) {
    expression.value = next.expression
    avatar.setExpression(next.expression)
  }
  const idle = next.idle && !reduced.matches
  avatar.setAutoIdle(idle)
  avatar.setAutoMotion(idle)
  playing.value = now < gestureUntil ? playing.value : ''

  // Gaze leads and the head follows; a playing motion gets most of the head back so it reads clearly.
  const face = toStage(gazeCentre.x, gazeCentre.y)
  const target = aim(next.look, next.head, { dx: pointer.x - face.x, dy: pointer.y - face.y, reach: Math.max(320, placement.value.width * 0.35) })
  followBodyLook(look, target, (now - lastFrameAt) / 1000)
  lastFrameAt = now
  weight += ((next.look === 'free' ? 0 : motion.value ? 0.3 : 0.8) - weight) * 0.08
  avatar.setParameters(look, weight)

  // Without audio to listen to, her mouth follows the rhythm of speech while text streams in or is read aloud.
  if (props.speaking && !reduced.matches) {
    if (!talking) {
      talking = true
      talkStart = now
      avatar.setSpeaking(true)
    }
    avatar.setVoiceLevel(voiceAt((now - talkStart) / 1000))
  }
  else if (talking) {
    talking = false
    avatar.setVoiceLevel(0)
    avatar.setSpeaking(false)
  }

  if (++frame % 6 === 0 && element.value) {
    const rect = element.value.getBoundingClientRect()
    // Her mouth as it is now drawn, moved with the head, so her words keep clear of it while she turns.
    const moved = head ? headPoint(mouth, head, avatar.getParameters()) : mouth
    const lips = toStage(moved.x, moved.y)
    const { hands } = props.body
    const hand = toStage(hands.cx + hands.rx * 0.5, hands.cy)
    emit('anchors', { mouth: { x: rect.left + lips.x, y: rect.top + lips.y }, hand: { x: rect.left + hand.x, y: rect.top + Math.min(hand.y, rect.height - 24) }, clearance: head ? (head.rx + Math.abs(head.cx - mouth.x)) * placement.value.scale : undefined })
  }
  requestAnimationFrame(tick)
}

function fail(cause: unknown) {
  if (disposed)
    return
  state.value = 'error'
  emit('unavailable', cause instanceof Error ? cause.message : String(cause))
}

onMounted(async () => {
  observer = new ResizeObserver(layout)
  observer.observe(element.value!)
  window.addEventListener('pointermove', track)
  window.addEventListener('keydown', stir)
  document.addEventListener('visibilitychange', returned)
  director.update(props.phase, performance.now())
  try {
    const opened = await openAvatar(props.body.archive ?? props.body.path!)
    if (disposed) {
      opened.release()
      return
    }
    avatarPackage = opened
    const { rig } = opened
    image = { width: rig.image.width, height: rig.image.height }
    mouth = { x: rig.mouth.cx, y: rig.mouth.cy }
    const stableRig = stabilizeBodyRig(rig)
    head = stableRig.head
    const centre = rig.view.gazeCenter ?? [rig.head.cx, rig.head.cy]
    gazeCentre = { x: centre[0]!, y: centre[1]! }
    regions = bodyRegions(rig, props.body.hands)
    // Without the outline she still reacts by region; touches in the air around her just count too.
    traceSilhouette(opened.assets['base.png']!).catch(() => {})
    layout()
    // No margins: the canvas is exactly her image, so stage and image pixels map by `placement` alone.
    const loaded = await loadMeshAvatar(canvas.value!, { ...opened, rig: stableRig }, { padTop: 0, padSide: 0, fit: 'contain', lipSync: { openness: 0.65 } })
    if (disposed) {
      loaded.destroy()
      return
    }
    avatar = loaded
    // A driver reset or waking from sleep leaves the canvas blank and nothing else would say so.
    canvas.value!.addEventListener('webglcontextlost', () => fail(new Error('显卡上下文丢失')))
    avatar.setTalkGain(0.18)
    avatar.setSwayGain(reduced.matches ? 0 : 0.5)
    avatar.onMotion((id) => { motion.value = id ?? '' })
    state.value = 'ready'
    requestAnimationFrame(tick)
  }
  catch (cause) { fail(cause) }
})
watch(() => props.phase, phase => director.update(phase, performance.now()))
watch(() => props.mode, (next, previous) => {
  if (!previous || next === previous)
    return
  const kind = gestureForModeChange(previous, next)
  const now = performance.now()
  playing.value = kind
  gestureUntil = now + bodyDirector.gesture(kind, now)
})
watch(() => props.cue?.at, () => props.cue && bodyDirector.cue(props.cue.kind, performance.now()))
watch(() => props.align, layout)
onBeforeUnmount(() => {
  disposed = true
  window.clearTimeout(pokeTimer)
  window.removeEventListener('pointermove', track)
  window.removeEventListener('keydown', stir)
  document.removeEventListener('visibilitychange', returned)
  observer?.disconnect()
  avatar?.destroy()
  // The runtime keeps its WebGL context for canvas reuse; this canvas is discarded, so free the context now
  // instead of piling one up per form switch until garbage collection.
  canvas.value?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()
  avatar = undefined
  avatarPackage?.release()
  avatarPackage = undefined
})
</script>

<template>
  <div ref="element" class="model-canvas body-stage" data-renderer="mesh" :data-avatar="body.archive ? 'mine' : 'hers'" :data-state="state" :data-performed="performed" :data-mode="mode" :data-gesture="playing" :data-motion="motion" :data-expression="expression" @click="event => touch(event, false)" @dblclick="event => touch(event, true)">
    <canvas ref="canvas" :style="{ left: `${placement.left}px`, top: `${placement.top}px`, width: `${placement.width}px`, height: `${placement.height}px` }" />
    <p v-if="state === 'loading'" class="stage-loading" role="status">正在唤醒 {{ name }}…</p>
  </div>
</template>
