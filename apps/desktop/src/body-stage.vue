<script setup lang="ts">
import type { AvatarPackage, MeshAvatar } from 'mesh-avatar'
import type { BodyExpression, BodyRegions } from '../../../packages/character/body'
import type { Companion, MotionCue } from '../../../packages/character/manifest'
import type { AnnaPhase, PermissionMode } from '../../../packages/shared/contracts'
import type { Anchors } from './character-stage.vue'
import { loadMeshAvatar, openAvatar } from 'mesh-avatar'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { aim, BodyDirector, bodyRegions, frameBody, motionSeconds, regionAt, voiceAt } from '../../../packages/character/body'
import { Director, gestureForModeChange } from '../../../packages/character/director'

const props = withDefaults(defineProps<{ body: NonNullable<Companion['body']>, name: string, phase?: AnnaPhase, mode?: PermissionMode, speaking?: boolean, listening?: boolean, align?: number, cue?: { kind: MotionCue, at: number } }>(), { phase: 'idle', mode: 'edit', speaking: false, listening: false, align: 0.5 })
/**
 * `anchors` reports her mouth and the hand she holds things in (viewport pixels). `unavailable` means the body cannot
 * be shown here: without a reason the archive is not on this machine (it is not committed), with one it failed to load.
 */
const emit = defineEmits<{ poke: [], anchors: [anchors: Anchors], unavailable: [reason?: string] }>()
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
const body = new BodyDirector()
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
let avatar: MeshAvatar | undefined
let avatarPackage: AvatarPackage | undefined
let image = { width: 1, height: 1 }
let mouth = { x: 0, y: 0 }
let gazeCentre = { x: 0, y: 0 }
let regions: BodyRegions | undefined
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

function layout() {
  if (!element.value)
    return
  const { width, height } = element.value.getBoundingClientRect()
  // Her arms rest just above the status ribbon (14px from the bottom, about 34px tall), so it never covers her hands.
  const fit = frameBody({ width, height }, props.body.crop, props.align, 54)
  placement.value = { ...fit, width: image.width * fit.scale, height: image.height * fit.scale }
}

/** Image pixels to stage pixels, and a stage point back to image pixels. */
const toStage = (x: number, y: number) => ({ x: placement.value.left + x * placement.value.scale, y: placement.value.top + y * placement.value.scale })
const toImage = (x: number, y: number) => ({ x: (x - placement.value.left) / placement.value.scale, y: (y - placement.value.top) / placement.value.scale })

function track(event: PointerEvent) {
  const rect = element.value?.getBoundingClientRect()
  if (!rect)
    return
  pointer.x = event.clientX - rect.left
  pointer.y = event.clientY - rect.top
  pointer.at = activeAt = performance.now()
  // Her outline, not the empty canvas around her, is what can be touched.
  if (regions && placement.value.scale)
    element.value!.style.cursor = regionAt(regions, toImage(pointer.x, pointer.y)) ? 'pointer' : 'default'
}
function stir() { activeAt = performance.now() }

function touch(event: MouseEvent, double: boolean) {
  const rect = element.value?.getBoundingClientRect()
  if (!rect || !regions || !placement.value.scale)
    return
  const region = regionAt(regions, toImage(event.clientX - rect.left, event.clientY - rect.top))
  if (!region)
    return
  activeAt = performance.now()
  body.touch(region, activeAt, double)
  // Her hands hold the work: touching them opens it, as a click on the Live2D stage does.
  if (region === 'hands' && !double)
    emit('poke')
}

function tick() {
  if (!avatar || disposed)
    return
  const now = performance.now()
  performed.value = director.tick(now)
  const next = body.frame(performed.value, now, { pointerAt: pointer.at, activeAt, listening: props.listening })
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
  for (const key of Object.keys(look) as (keyof typeof look)[])
    look[key] += (target[key] - look[key]) * 0.12
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
    const lips = toStage(mouth.x, mouth.y)
    const { hands } = props.body
    const hand = toStage(hands.cx + hands.rx * 0.5, hands.cy)
    emit('anchors', { mouth: { x: rect.left + lips.x, y: rect.top + lips.y }, hand: { x: rect.left + hand.x, y: rect.top + Math.min(hand.y, rect.height - 24) } })
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
  director.update(props.phase, performance.now())
  try {
    const response = await fetch(props.body.path).catch(() => undefined)
    if (!response?.ok) {
      if (!disposed)
        emit('unavailable')
      return
    }
    const opened = await openAvatar(await response.arrayBuffer())
    if (disposed) {
      opened.release()
      return
    }
    avatarPackage = opened
    const { rig } = opened
    image = { width: rig.image.width, height: rig.image.height }
    mouth = { x: rig.mouth.cx, y: rig.mouth.cy }
    const centre = rig.view.gazeCenter ?? [rig.head.cx, rig.head.cy]
    gazeCentre = { x: centre[0]!, y: centre[1]! }
    regions = bodyRegions(rig, props.body.hands)
    layout()
    // No margins: the canvas is exactly her image, so stage and image pixels map by `placement` alone.
    const loaded = await loadMeshAvatar(canvas.value!, opened, { padTop: 0, padSide: 0, fit: 'contain' })
    if (disposed) {
      loaded.destroy()
      return
    }
    avatar = loaded
    avatar.onMotion((id) => { motion.value = id ?? '' })
    if (reduced.matches)
      avatar.setSwayGain(0)
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
  body.gesture(kind, performance.now())
  playing.value = kind
  gestureUntil = performance.now() + motionSeconds[kind === 'shake' ? 'no' : kind] * 1000
})
watch(() => props.cue?.at, () => props.cue && body.cue(props.cue.kind, performance.now()))
watch(() => props.align, layout)
onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('pointermove', track)
  window.removeEventListener('keydown', stir)
  observer?.disconnect()
  avatar?.destroy()
  avatar = undefined
  avatarPackage?.release()
  avatarPackage = undefined
})
</script>

<template>
  <div ref="element" class="model-canvas body-stage" data-renderer="mesh" :data-state="state" :data-performed="performed" :data-mode="mode" :data-gesture="playing" :data-motion="motion" :data-expression="expression" @click="event => touch(event, false)" @dblclick="event => touch(event, true)">
    <canvas ref="canvas" :style="{ left: `${placement.left}px`, top: `${placement.top}px`, width: `${placement.width}px`, height: `${placement.height}px` }" />
    <p v-if="state === 'loading'" class="stage-loading" role="status">正在唤醒 {{ name }}…</p>
  </div>
</template>
