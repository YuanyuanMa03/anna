<script setup lang="ts">
import type { Command, MyProvider, PresetSummary, RuntimeSnapshot } from '../../../../packages/shared/contracts'
import { computed, ref } from 'vue'
import { companion } from '../../../../packages/character/manifest'

type App = 'claude' | 'codex' | 'gemini'
const props = defineProps<{ snapshot: RuntimeSnapshot, locked: boolean }>()
const emit = defineEmits<{ command: [command: Command] }>()
const apps: App[] = ['claude', 'codex', 'gemini']
const labels: Record<App, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' }
const sources: Record<MyProvider['source'], string> = { preset: '预设', custom: '自定义', imported: '从 cc-switch 导入' }
const app = ref<App>('claude')
const agents = computed(() => props.snapshot.agents)
/** Whoever is on stage picks and uses providers; the app itself stays "Anna". */
const who = computed(() => companion(props.snapshot.settings.characterId).name)
const mine = computed(() => agents.value.mine[app.value] ?? [])
const inUse = computed(() => agents.value.providers[app.value]?.provider)
const global = computed(() => agents.value.global[app.value])

/** The add/edit form: `previous` is set while editing, `from` when starting from a preset. */
const editor = ref<{ previous?: string, from?: string, name: string, baseUrl: string, model: string, key: string, apiKeyUrl?: string, website?: string }>()
const search = ref('')
const removing = ref<string>()
/** Writing a provider by hand instead of picking a preset. */
const custom = ref(false)
const results = computed(() => {
  const query = search.value.trim().toLowerCase()
  const list = (agents.value.presets[app.value] ?? []).filter(preset => !preset.official)
  return query ? list.filter(preset => [preset.name, preset.website, preset.baseUrl].some(text => text?.toLowerCase().includes(query))) : list
})
const categories: Record<string, string> = { cn_official: '国内官方', aggregator: '聚合与中转', third_party: '第三方', cloud_provider: '云平台', local: '本机模型' }
const grouped = computed(() => {
  const groups = new Map<string, PresetSummary[]>()
  for (const preset of results.value) groups.set(preset.category, [...(groups.get(preset.category) ?? []), preset])
  const order = Object.keys(categories)
  return [...groups.entries()].sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)).map(([category, presets]) => ({ category, label: categories[category] ?? category, presets }))
})
function host(url?: string) {
  try { return url ? new URL(url).host : '' }
  catch { return url ?? '' }
}

function startAdd() {
  removing.value = undefined
  search.value = ''
  custom.value = false
  editor.value = { name: '', baseUrl: '', model: '', key: '' }
}
function pick(preset: PresetSummary) {
  editor.value = { from: preset.name, name: mine.value.some(item => item.name === preset.name) ? `${preset.name} 2` : preset.name, baseUrl: preset.baseUrl ?? '', model: preset.model ?? '', key: '', apiKeyUrl: preset.apiKeyUrl, website: preset.website }
}
function edit(provider: MyProvider) {
  removing.value = undefined
  editor.value = { previous: provider.name, name: provider.name, baseUrl: provider.baseUrl ?? '', model: provider.model ?? '', key: '', apiKeyUrl: provider.apiKeyUrl, website: provider.website }
}
function save() {
  const draft = editor.value!
  emit('command', { type: 'provider-save', app: app.value, name: draft.name, previous: draft.previous, from: draft.from, baseUrl: draft.baseUrl, model: draft.model, key: draft.key || undefined })
  editor.value = undefined
}
const use = (name?: string) => emit('command', { type: 'agent-provider', agent: app.value, provider: name })
</script>

<template>
  <div class="providers">
    <p class="small muted">派活或把它当大脑时，Anna 只给那个 agent 的进程注入这里选的服务商，不改你的配置文件。“应用到全局”才会像 cc-switch 一样写入它的配置：只改连接相关的字段，首次写入前会备份，可以一键恢复。预设来自 cc-switch（MIT）。</p>
    <div class="app-tabs" role="tablist" aria-label="选择 agent">
      <button v-for="id in apps" :key="id" role="tab" :aria-selected="app === id" :data-app="id" @click="app = id; editor = undefined; removing = undefined">{{ labels[id] }}</button>
    </div>
    <p class="small status-line" :data-app="app">{{ who }} 用：<strong>{{ inUse ?? '它自己的登录' }}</strong> · 全局：{{ global?.switched ? `已切换到 ${global.provider}` : '未修改' }}<button v-if="global?.switched" class="link" :disabled="locked" @click="emit('command', { type: 'provider-restore', app })">恢复原配置</button></p>

    <ul v-if="!editor" class="provider-list" :aria-label="`${labels[app]} 的服务商`">
      <li :class="{ current: !inUse }" data-provider="">
        <div class="agent-main"><strong>它自己的登录</strong><span v-if="!inUse" class="badge ok">{{ who }} 正在用</span></div>
        <p class="small muted">用 {{ labels[app] }} 自己登录的账号和配置。</p>
        <div class="card-actions left"><button v-if="inUse" :disabled="locked" @click="use(undefined)">让{{ who }}用它</button></div>
      </li>
      <li v-for="provider in mine" :key="provider.name" :class="{ current: inUse === provider.name }" :data-provider="provider.name">
        <div class="agent-main">
          <strong>{{ provider.name }}</strong>
          <span class="badge muted-badge">{{ sources[provider.source] }}</span>
          <span v-if="inUse === provider.name" class="badge ok">{{ who }} 正在用</span>
          <span v-if="global?.switched && global.provider === provider.name" class="badge">全局</span>
          <span class="badge" :class="provider.hasKey ? 'ok' : 'warn'">{{ provider.hasKey ? '已存密钥' : '没有密钥' }}</span>
        </div>
        <p class="small muted">{{ host(provider.baseUrl) || '未设置地址' }}{{ provider.model ? ` · ${provider.model}` : '' }}</p>
        <div v-if="removing === provider.name" class="card approval-request" role="alert">
          <strong>删除 {{ provider.name }}？</strong>
          <p class="small muted">它的密钥会一起删掉。{{ inUse === provider.name ? `${who} 会改用它自己的登录。` : '' }}已经应用到全局的配置不会动，需要的话先“恢复原配置”。</p>
          <div class="card-actions"><button @click="removing = undefined">取消</button><button class="primary" :disabled="locked" @click="emit('command', { type: 'provider-delete', app, name: provider.name }); removing = undefined">删除</button></div>
        </div>
        <div v-else class="card-actions left">
          <button v-if="inUse !== provider.name" :disabled="locked" @click="use(provider.name)">让{{ who }}用它</button>
          <button :disabled="locked || !provider.hasKey" :title="provider.hasKey ? '' : '先存一个密钥'" @click="emit('command', { type: 'provider-global', app, provider: provider.name })">应用到全局</button>
          <button :disabled="locked" @click="edit(provider)">编辑</button>
          <button class="link danger-link" :disabled="locked" @click="removing = provider.name">删除</button>
        </div>
      </li>
    </ul>
    <button v-if="!editor" class="add-provider" :disabled="locked" @click="startAdd">＋ 添加服务商</button>

    <section v-if="editor && !editor.previous && !editor.from && !custom" class="preset-picker" aria-label="选择预设">
      <div class="sheet-heading"><h3>添加 {{ labels[app] }} 服务商</h3><button class="link" @click="editor = undefined">取消</button></div>
      <input v-model="search" type="search" aria-label="搜索预设" placeholder="搜索名称或域名，例如 DeepSeek、kimi、openrouter.ai">
      <button class="preset-custom" @click="custom = true">自定义：自己填地址和模型</button>
      <div v-for="group in grouped" :key="group.category" class="preset-group">
        <h4>{{ group.label }}</h4>
        <button v-for="preset in group.presets" :key="preset.name" class="preset-item" :data-preset="preset.name" @click="pick(preset)"><strong>{{ preset.name }}</strong><span>{{ host(preset.baseUrl) }}</span></button>
      </div>
      <p v-if="!results.length" class="small muted">没有找到，可以用“自定义”。</p>
    </section>

    <form v-else-if="editor" class="provider-editor" @submit.prevent="save(); custom = false">
      <div class="sheet-heading"><h3>{{ editor.previous ? `编辑 ${editor.previous}` : editor.from ? `添加 ${editor.from}` : '自定义服务商' }}</h3><button type="button" class="link" @click="editor = undefined; custom = false">取消</button></div>
      <label>名称<input v-model="editor.name" required maxlength="60" aria-label="服务商名称"></label>
      <label>请求地址<input v-model="editor.baseUrl" :required="!editor.from && !editor.previous" aria-label="请求地址" :placeholder="app === 'claude' ? 'https://…（Anthropic Messages 接口）' : app === 'codex' ? 'https://…（OpenAI Responses 接口）' : 'https://…'"></label>
      <label>模型<input v-model="editor.model" :required="app === 'codex' && !editor.from && !editor.previous" aria-label="模型" placeholder="留空用预设的默认模型"></label>
      <label>API Key<input v-model="editor.key" type="password" autocomplete="off" aria-label="API Key" :placeholder="editor.previous && mine.find(item => item.name === editor!.previous)?.hasKey ? '已保存，留空保持' : '输入服务商密钥'"></label>
      <a v-if="editor.apiKeyUrl" class="link small" :href="editor.apiKeyUrl" target="_blank" rel="noreferrer">去获取密钥 ↗</a>
      <p v-if="app === 'codex'" class="small muted">Codex 只支持 OpenAI Responses 接口；只提供 Chat Completions 的服务商要等本地路由（下一阶段）。</p>
      <div class="card-actions"><button type="submit" class="primary" :disabled="locked">保存</button></div>
    </form>
  </div>
</template>
