<script setup lang="ts">
import type { Command, RuntimeSnapshot, UniversalDraft, UniversalProvider } from '../../../../packages/shared/contracts'
import { computed, ref } from 'vue'

const props = defineProps<{ snapshot: RuntimeSnapshot, locked: boolean }>()
const emit = defineEmits<{ command: [command: Command] }>()
const labels = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' } as const
const list = computed(() => props.snapshot.agents.universal ?? [])
const editor = ref<UniversalDraft>()
const tiers = ref(false)
const removing = ref<string>()
/** A plain deep copy: Vue's reactive proxies can't go through structuredClone or the IPC bridge. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}
function host(url: string) {
  try { return new URL(url).host }
  catch { return url }
}

function start(item?: UniversalProvider) {
  removing.value = undefined
  tiers.value = Boolean(item?.models.claude?.haiku || item?.models.claude?.sonnet || item?.models.claude?.opus)
  editor.value = item
    ? { ...plain(item), previous: item.name, key: '' }
    : { name: '', baseUrl: '', key: '', apps: { claude: true, codex: true, gemini: true }, models: { claude: {}, codex: { reasoningEffort: 'high' }, gemini: {} } }
}
function save() {
  emit('command', { type: 'universal-save', ...plain(editor.value!) })
  editor.value = undefined
}
</script>

<template>
  <div class="universal">
    <p class="small muted">一个网关、一个密钥，同时给 Claude Code、Codex 和 Gemini CLI 用，适合 NewAPI 这类同时支持 Anthropic、OpenAI 和 Gemini 协议的网关。保存后每个勾选的 agent 下都会出现一个同名服务商，改这里就一起改。</p>
    <ul v-if="!editor" class="provider-list" aria-label="统一服务商">
      <li v-for="item in list" :key="item.name" :data-universal="item.name">
        <div class="agent-main">
          <strong>{{ item.name }}</strong>
          <span v-for="(on, app) in item.apps" v-show="on" :key="app" class="badge">{{ labels[app] }}</span>
          <span class="badge" :class="item.hasKey ? 'ok' : 'warn'">{{ item.hasKey ? '已存密钥' : '没有密钥' }}</span>
        </div>
        <p class="small muted">{{ host(item.baseUrl) }}{{ item.apps.codex && item.models.codex?.model ? ` · Codex：${item.models.codex.model}` : '' }}{{ item.apps.claude && item.models.claude?.model ? ` · Claude：${item.models.claude.model}` : '' }}</p>
        <div v-if="removing === item.name" class="card approval-request" role="alert">
          <strong>删除 {{ item.name }}？</strong>
          <p class="small muted">各个 agent 下同名的服务商和密钥会一起删掉；正在用它的 agent 会改回它自己的登录。</p>
          <div class="card-actions"><button @click="removing = undefined">取消</button><button class="primary" :disabled="locked" @click="emit('command', { type: 'universal-delete', name: item.name }); removing = undefined">删除</button></div>
        </div>
        <div v-else class="card-actions left">
          <button :disabled="locked" @click="start(item)">编辑</button>
          <button class="link danger-link" :disabled="locked" @click="removing = item.name">删除</button>
        </div>
      </li>
    </ul>
    <button v-if="!editor" class="add-provider" :disabled="locked" @click="start()">＋ 添加统一服务商</button>

    <form v-else class="provider-editor" @submit.prevent="save">
      <div class="sheet-heading"><h3>{{ editor.previous ? `编辑 ${editor.previous}` : '添加统一服务商' }}</h3><button type="button" class="link" @click="editor = undefined">取消</button></div>
      <label>名称<input v-model="editor.name" required maxlength="60" aria-label="统一服务商名称" placeholder="例如 NewAPI"></label>
      <label>网关地址<input v-model="editor.baseUrl" required aria-label="网关地址" placeholder="https://your-gateway.example.com"></label>
      <label>API Key<input v-model="editor.key" type="password" autocomplete="off" aria-label="统一服务商 API Key" :placeholder="editor.previous && list.find(item => item.name === editor!.previous)?.hasKey ? '已保存，留空保持' : '输入网关密钥'"></label>
      <fieldset class="apps-choice">
        <legend>用在</legend>
        <label v-for="(label, app) in labels" :key="app" class="check"><input v-model="editor.apps[app]" type="checkbox" :aria-label="`用在 ${label}`">{{ label }}</label>
      </fieldset>
      <template v-if="editor.apps.claude">
        <label>Claude Code 模型<input v-model="editor.models.claude!.model" aria-label="Claude Code 模型" placeholder="留空用 Claude Code 默认"></label>
        <button v-if="!tiers" type="button" class="link" @click="tiers = true">分别设置 Haiku / Sonnet / Opus</button>
        <div v-else class="tier-models">
          <label>Haiku<input v-model="editor.models.claude!.haiku" aria-label="Haiku 模型"></label>
          <label>Sonnet<input v-model="editor.models.claude!.sonnet" aria-label="Sonnet 模型"></label>
          <label>Opus<input v-model="editor.models.claude!.opus" aria-label="Opus 模型"></label>
        </div>
      </template>
      <div v-if="editor.apps.codex" class="tier-models">
        <label>Codex 模型<input v-model="editor.models.codex!.model" required aria-label="Codex 模型" placeholder="例如 gpt-5.6"></label>
        <label>思考强度<select v-model="editor.models.codex!.reasoningEffort" aria-label="Codex 思考强度"><option value="">默认</option><option v-for="effort in ['low', 'medium', 'high', 'xhigh']" :key="effort" :value="effort">{{ effort }}</option></select></label>
      </div>
      <label v-if="editor.apps.gemini">Gemini CLI 模型<input v-model="editor.models.gemini!.model" aria-label="Gemini CLI 模型" placeholder="留空用 Gemini CLI 默认"></label>
      <p class="small muted">Codex 会用网关地址加 <code>/v1</code>（地址本身带路径时照原样用）。</p>
      <div class="card-actions"><button type="submit" class="primary" :disabled="locked">保存</button></div>
    </form>
  </div>
</template>
