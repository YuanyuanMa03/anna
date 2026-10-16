<script setup lang="ts">
import type { Command, ModelSettings, RuntimeSnapshot } from '../../../packages/shared/contracts'
import { reactive, ref } from 'vue'

const props = defineProps<{ snapshot: RuntimeSnapshot, busy: boolean }>()
const emit = defineEmits<{ command: [command: Command], close: [] }>()
const model = reactive<ModelSettings>({ ...props.snapshot.settings.model })
const key = ref('')
function save() { emit('command', { type: 'configure', model: { ...model }, key: key.value }); key.value = '' }
function selectProvider() {
  if (model.provider === 'deepseek-official') { model.baseURL = 'https://api.deepseek.com/anthropic'; model.model = 'deepseek-v4-flash'; model.api = 'anthropic-messages' }
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <section class="sheet" role="dialog" aria-modal="true" aria-label="模型与设置">
      <div class="sheet-heading"><div><span class="eyebrow">CONNECTION</span><h2>让 Anna 开始思考</h2></div><button aria-label="关闭设置" class="icon-button" @click="emit('close')">×</button></div>
      <p class="muted">模型连接由本机 DSH 执行。密钥通过系统凭据加密保存。</p>
      <form @submit.prevent="save">
        <label>模型提供商<select v-model="model.provider" @change="selectProvider"><option value="deepseek-official">DeepSeek · 官方 API</option><option value="custom">自定义 · DSH 通用模型适配器</option></select></label>
        <label>API 协议<select v-model="model.api" :disabled="model.provider === 'deepseek-official'"><option value="anthropic-messages">Anthropic Messages</option><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option></select></label>
        <label>API 端点<input v-model="model.baseURL" type="url" required aria-label="API 端点"></label>
        <label>模型 ID<input v-model="model.model" required aria-label="模型 ID" list="models"><datalist id="models"><option value="deepseek-v4-flash" /><option value="deepseek-v4-pro" /><option value="glm-5.3" /></datalist></label>
        <label>API Key<input v-model="key" type="password" autocomplete="off" :placeholder="snapshot.hasKey ? '已保存，留空保持原密钥' : '输入供应商密钥'" aria-label="API Key"></label>
        <button class="primary" :disabled="busy" type="submit">保存模型配置</button>
      </form>
      <button :disabled="busy || !snapshot.hasKey" @click="emit('command', { type: 'send', text: 'Anna，你好，介绍一下你自己。' })">测试真实 DSH 对话</button>
      <p class="muted small">连接状态：{{ snapshot.state }} · {{ snapshot.settings.model.model }}<br>会话：{{ snapshot.sessionId ?? '首次对话后保存' }}<br>{{ snapshot.restored ? '已通过 DSH 持久化接口恢复会话' : '尚未确认跨进程恢复' }}</p>
      <button :disabled="busy" @click="emit('command', { type: 'new-session' })">开始新会话</button>
      <p class="muted small">新会话会清空当前界面的对话。旧 DSH 会话文件继续保留。<br>角色素材属于 Live2D 样例，使用前请阅读随附许可证。</p>
    </section>
  </div>
</template>
