<script setup lang="ts">
import type { SpeechConfig, VoiceConfig, VoiceMode } from '../../../../packages/voice/contracts'
import { ref, watch } from 'vue'

const props = defineProps<{ label: string, synthesis?: boolean, config?: SpeechConfig | VoiceConfig, hasKey?: boolean, disabled: boolean }>()
const emit = defineEmits<{ save: [config: VoiceConfig, key?: string], dirty: [value: boolean] }>()
const mode = ref<VoiceMode>('local')
const baseURL = ref('http://127.0.0.1:17861/v1')
const model = ref(props.synthesis ? 'kokoro-local' : 'paraformer-local')
const voice = ref('anna')
const key = ref('')
const replaceKey = ref(false)
watch([mode, baseURL, model, voice, key, replaceKey], () => emit('dirty', true), { flush: 'sync' })
watch(() => props.config, (config) => {
  if (config) {
    mode.value = config.mode ?? (new URL(config.baseURL).hostname === '127.0.0.1' ? 'local' : 'cloud')
    baseURL.value = config.baseURL
    model.value = config.model
    voice.value = 'voice' in config ? config.voice : 'anna'
  }
  key.value = ''
  replaceKey.value = false
  emit('dirty', false)
}, { immediate: true })
function switchMode() {
  key.value = ''
  replaceKey.value = true
  baseURL.value = mode.value === 'local' ? 'http://127.0.0.1:17861/v1' : ''
  model.value = mode.value === 'local' ? (props.synthesis ? 'kokoro-local' : 'paraformer-local') : ''
  voice.value = mode.value === 'local' ? 'anna' : ''
}
function save() {
  emit('save', { mode: mode.value, baseURL: baseURL.value, model: model.value, voice: voice.value }, key.value || replaceKey.value ? key.value : undefined)
}
</script>

<template>
  <form :aria-label="`${label}配置`" @submit.prevent="save">
    <fieldset :disabled="disabled">
      <legend>{{ label }}</legend>
      <label>接入方式<select v-model="mode" aria-label="接入方式" @change="switchMode"><option value="local">本地部署</option><option value="cloud">云端 API</option></select></label>
      <p v-if="mode === 'local'" class="hint">在这台电脑上处理语音。请先准备好模型并启动本地语音服务。</p>
      <p v-else class="hint">直接连接支持语音{{ synthesis ? '合成' : '识别' }}的兼容 API。{{ synthesis ? '回复文字' : '录音' }}会发送到所填服务，可能产生费用。</p>
      <label>服务地址<input v-model="baseURL" type="url" required placeholder="https://服务地址/v1"></label>
      <label>模型 ID<input v-model="model" required maxlength="200"></label>
      <label v-if="synthesis">音色 ID<input v-model="voice" required maxlength="200"></label>
      <label>API Key<input v-model="key" type="password" autocomplete="new-password" :placeholder="hasKey ? '已保存，留空保留' : '本机服务可留空'"></label>
      <label class="checkbox"><input v-model="replaceKey" type="checkbox">替换密钥（输入框为空则清除）</label>
      <button type="submit">保存{{ label }}配置</button>
    </fieldset>
  </form>
</template>

<style scoped>
fieldset { border: 1px solid #ddd7cf; border-radius: 12px; margin: 16px 0; padding: 16px; }
legend { padding: 0 6px; font-weight: 600; }
label { display: block; margin: 10px 0; }
input:not([type="checkbox"]), select { display: block; width: 100%; box-sizing: border-box; padding: 8px; margin-top: 5px; }
.hint { font-size: 13px; color: #65655f; line-height: 1.6; }
.checkbox { font-size: 13px; }
</style>
