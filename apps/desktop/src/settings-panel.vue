<script setup lang="ts">
import type { Command, ModelSettings, RuntimeSnapshot } from '../../../packages/shared/contracts'
import { computed, reactive, ref } from 'vue'

const props = defineProps<{ snapshot: RuntimeSnapshot, busy: boolean }>()
const emit = defineEmits<{ command: [command: Command], close: [] }>()
const model = reactive<ModelSettings>({ ...props.snapshot.settings.model })
const key = ref('')
const installed = (id: string) => props.snapshot.agents.detected.find(agent => agent.id === id)
const brains = computed(() => [
  { id: 'pi' as const, label: 'pi', note: '内置 · 使用下面配置的模型', available: true },
  { id: 'claude-code' as const, label: 'Claude Code', note: installed('claude')?.installed ? `v${installed('claude')?.version ?? '?'}${installed('claude')?.loggedIn === false ? ' · 未登录' : ''}` : '未安装', available: Boolean(installed('claude')?.installed) },
  { id: 'codex' as const, label: 'Codex', note: installed('codex')?.installed ? `v${installed('codex')?.version ?? '?'}${installed('codex')?.loggedIn === false ? ' · 未登录' : ''}` : '未安装', available: Boolean(installed('codex')?.installed) },
])
function save() { emit('command', { type: 'configure', model: { ...model }, key: key.value }); key.value = '' }
function selectProvider() {
  if (model.provider === 'deepseek-official') { model.baseURL = 'https://api.deepseek.com'; model.model = 'deepseek-flash'; model.api = 'openai-completions' }
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <section class="sheet" role="dialog" aria-modal="true" aria-label="模型与设置">
      <div class="sheet-heading"><div><span class="eyebrow">CONNECTION</span><h2>让 Anna 开始思考</h2></div><button aria-label="关闭设置" class="icon-button" @click="emit('close')">×</button></div>
      <h3>Anna 的大脑</h3>
      <div class="brain-options" role="radiogroup" aria-label="Anna 的大脑">
        <button v-for="brain in brains" :key="brain.id" type="button" role="radio" :aria-checked="snapshot.settings.kernel === brain.id" :disabled="busy || !brain.available" @click="snapshot.settings.kernel !== brain.id && emit('command', { type: 'kernel', id: brain.id })"><strong>{{ brain.label }}</strong><small>{{ brain.note }}</small></button>
      </div>
      <p class="muted small">换大脑后人格、记忆、权限模式和舞台都不变。Claude Code / Codex 使用它们自己的登录和服务商（在“外部 agent”里设置），会开始一个新会话；Anna 的自带工具（记忆、状态、派活）只在 pi 大脑下可用。</p>
      <template v-if="snapshot.settings.kernel === 'pi'">
        <h3>pi 的模型</h3>
        <p class="muted">pi coding agent 运行在独立的核心进程里。密钥通过系统凭据加密保存，只在请求模型时使用。</p>
        <form @submit.prevent="save">
          <label>模型提供商<select v-model="model.provider" @change="selectProvider"><option value="deepseek-official">DeepSeek · 官方 API（pi 内置目录）</option><option value="custom">自定义 · 兼容 OpenAI / Anthropic 的端点</option></select></label>
          <template v-if="model.provider === 'custom'">
            <label>API 协议<select v-model="model.api"><option value="anthropic-messages">Anthropic Messages</option><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option></select></label>
            <label>API 端点<input v-model="model.baseURL" type="url" required aria-label="API 端点"></label>
          </template>
          <label>模型 ID<input v-model="model.model" required aria-label="模型 ID" list="models"><datalist id="models"><option v-if="model.provider === 'deepseek-official'" value="deepseek-flash" /><option v-if="model.provider === 'deepseek-official'" value="deepseek-v4-pro" /><option v-if="model.provider === 'custom'" value="glm-5.3" /></datalist></label>
          <label>API Key<input v-model="key" type="password" autocomplete="off" :placeholder="snapshot.hasKey ? '已保存，留空保持原密钥' : '输入供应商密钥'" aria-label="API Key"></label>
          <button class="primary" :disabled="busy" type="submit">保存并连接</button>
        </form>
      </template>
      <button :disabled="busy || (!snapshot.hasKey && snapshot.settings.kernel === 'pi')" @click="emit('command', { type: 'send', text: 'Anna，你好，介绍一下你自己。' })">测试一次真实对话</button>
      <p class="muted small">连接状态：{{ snapshot.state }} · {{ snapshot.model?.id ?? snapshot.settings.model.model }}{{ snapshot.model ? ` · 思考 ${snapshot.model.thinking} · 上下文 ${Math.round(snapshot.model.contextWindow / 1000)}K` : '' }}<br>会话：{{ snapshot.sessionId ?? '首次对话后保存' }}<br>{{ snapshot.restored ? '已恢复上次的 pi 会话' : '新会话' }}</p>
      <button :disabled="busy" @click="emit('command', { type: 'new-session' })">开始新会话</button>
      <p class="muted small">新会话会清空当前界面的对话，旧会话文件继续保留。长任务会自动压缩上下文。</p>
    </section>
  </div>
</template>
