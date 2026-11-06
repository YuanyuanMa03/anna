<script setup lang="ts">
import type { SpeechConfig, VoiceConfig, VoiceMode, VoiceProtocol } from '../../../../packages/voice/contracts'
import { ref, watch } from 'vue'
import { cloudKeyPage, cloudVoices, payAsYouGoURL, speechDefaults } from '../../../../packages/voice/presets'

const props = defineProps<{ label: string, synthesis?: boolean, config?: SpeechConfig | VoiceConfig, hasKey?: boolean, disabled: boolean }>()
const emit = defineEmits<{ save: [config: VoiceConfig, key?: string], dirty: [value: boolean] }>()
// A new form starts in the cloud: a fresh install has no local speech service, only the key is missing.
const initial = speechDefaults('cloud', props.synthesis)
const mode = ref<VoiceMode>('cloud')
const protocol = ref<VoiceProtocol>(initial.protocol)
const baseURL = ref(initial.baseURL)
const model = ref(initial.model)
const voice = ref(initial.voice)
const key = ref('')
const replaceKey = ref(false)
watch([mode, protocol, baseURL, model, voice, key, replaceKey], () => emit('dirty', true), { flush: 'sync' })
watch(() => props.config, (config) => {
  if (config) {
    mode.value = config.mode ?? (new URL(config.baseURL).hostname === '127.0.0.1' ? 'local' : 'cloud')
    protocol.value = config.protocol ?? 'audio'
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
  const preset = speechDefaults(mode.value, props.synthesis)
  protocol.value = preset.protocol
  baseURL.value = preset.baseURL
  model.value = preset.model
  voice.value = preset.voice
}
function save() {
  emit('save', { mode: mode.value, protocol: protocol.value, baseURL: baseURL.value, model: model.value, voice: voice.value }, key.value || replaceKey.value ? key.value : undefined)
}
</script>

<template>
  <form :aria-label="`${label}配置`" @submit.prevent="save">
    <fieldset :disabled="disabled">
      <legend>{{ label }}</legend>
      <label>接入方式<select v-model="mode" aria-label="接入方式" @change="switchMode"><option value="local">本地部署</option><option value="cloud">云端 API</option></select></label>
      <p v-if="mode === 'local'" class="hint">在这台电脑上处理语音。请先准备好模型并启动本地语音服务。</p>
      <p v-else class="hint">默认填好了小米 MiMo 的 Token Plan，只需填入 <a :href="cloudKeyPage" target="_blank" rel="noreferrer">MiMo 开放平台</a> 的 API Key；按量付费的 sk- 密钥请把地址改为 {{ payAsYouGoURL }}。识别与合成用同一地址时填一次即可。也可改成其他兼容 API。{{ synthesis ? '回复文字' : '录音' }}会发送到所填服务，可能产生费用。</p>
      <label>接口格式<select v-model="protocol" aria-label="接口格式"><option value="chat">对话接口（小米 MiMo）</option><option value="audio">OpenAI 语音接口（/audio）</option></select></label>
      <label>服务地址<input v-model="baseURL" type="url" required placeholder="https://服务地址/v1"></label>
      <label>模型 ID<input v-model="model" required maxlength="200"></label>
      <label v-if="synthesis">音色 ID<input v-model="voice" required maxlength="200" :list="protocol === 'chat' ? 'mimo-voices' : undefined"></label>
      <datalist v-if="synthesis" id="mimo-voices"><option v-for="name in cloudVoices" :key="name" :value="name" /></datalist>
      <label>API Key<input v-model="key" type="password" autocomplete="new-password" :placeholder="hasKey ? '已保存，留空保留' : mode === 'local' ? '本机服务可留空' : '与另一项同一地址时可留空'"></label>
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
