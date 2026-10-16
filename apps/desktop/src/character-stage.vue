<script setup lang="ts">
import type { AnnaCharacter } from '../../../packages/character/manifest'
import { install } from '@pixi/unsafe-eval'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { Application, ShaderSystem, Ticker } from 'pixi.js'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fitStage } from '../../../packages/character/manifest'

const props = defineProps<{ character: AnnaCharacter, speaking: boolean }>()
const element = ref<HTMLDivElement>()
const state = ref('loading')
const error = ref('')
let app: Application | undefined
let model: Live2DModel | undefined
let observer: ResizeObserver | undefined
let generation = 0
let bounds = { width: 1, height: 1 }
install({ ShaderSystem })
Live2DModel.registerTicker(Ticker)
function layout() {
  if (!app || !model || !element.value)
    return
  const { width, height } = element.value.getBoundingClientRect()
  app.renderer.resize(width, height)
  const fit = fitStage(width, height, bounds.width, bounds.height, props.character.stage.scale)
  model.scale.set(fit.scale)
  model.position.set(fit.x + props.character.stage.offsetX, fit.y + props.character.stage.offsetY)
}
async function load() {
  const current = ++generation
  state.value = 'loading'
  error.value = ''
  if (model) { app?.stage.removeChild(model); model.destroy({ children: true, texture: true, baseTexture: true }); model = undefined }
  try {
    const loaded = await Live2DModel.from(props.character.modelPath, { autoInteract: true })
    if (current !== generation || !app) { loaded.destroy({ children: true, texture: true, baseTexture: true }); return }
    model = loaded
    bounds = { width: model.width, height: model.height }
    model.anchor.set(0.5)
    app.stage.addChild(model)
    layout()
    state.value = 'ready'
  }
  catch (cause) { if (current === generation) { state.value = 'error'; error.value = cause instanceof Error ? cause.message : String(cause) } }
}
onMounted(() => {
  app = new Application({ backgroundAlpha: 0, antialias: true, resolution: Math.min(window.devicePixelRatio, 1.5), autoDensity: true })
  app.ticker.maxFPS = 30
  element.value!.appendChild(app.view)
  observer = new ResizeObserver(layout)
  observer.observe(element.value!)
  app.ticker.add(() => {
    if (props.speaking && model) {
      const core = model.internalModel.coreModel
      if ('setParameterValueById' in core && typeof core.setParameterValueById === 'function')
        core.setParameterValueById('ParamMouthOpenY', 0.3 + Math.sin(performance.now() / 90) * 0.25)
    }
  })
  void load()
})
watch(() => props.character.id, load)
onBeforeUnmount(() => { generation++; observer?.disconnect(); model?.destroy({ children: true, texture: true, baseTexture: true }); model = undefined; app?.destroy(true, { children: true }); app = undefined })
</script>

<template>
  <div ref="element" class="model-canvas" :data-character="character.id" :data-state="state">
    <p v-if="state === 'loading'" class="stage-loading" role="status">正在唤醒 {{ character.name }}…</p>
    <p v-if="error" class="stage-error" role="alert">模型加载失败：{{ error }}</p>
  </div>
</template>
