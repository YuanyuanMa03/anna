<script setup lang="ts">
import type { Command, MyProvider, PresetSummary, RuntimeSnapshot } from '../../../../packages/shared/contracts'
import { computed, ref, watch } from 'vue'
import { companion } from '../../../../packages/character/manifest'
import UniversalPanel from './universal-panel.vue'

type App = 'claude' | 'codex' | 'gemini'
const props = defineProps<{ snapshot: RuntimeSnapshot, locked: boolean }>()
const emit = defineEmits<{ command: [command: Command] }>()
const apps: App[] = ['claude', 'codex', 'gemini']
const labels: Record<App, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' }
const sources: Record<MyProvider['source'], string> = { preset: '预设', custom: '自定义', imported: '从 cc-switch 导入', universal: '统一服务商' }
const app = ref<App | 'universal'>('claude')
/** The app whose providers are shown (the universal tab has its own panel). */
const current = computed<App>(() => app.value === 'universal' ? 'claude' : app.value)
const agents = computed(() => props.snapshot.agents)
/** Whoever is on stage picks and uses providers; the app itself stays "Anna". */
const who = computed(() => companion(props.snapshot.settings.characterId).name)
/** Latin names get spaces inside Chinese text ("让 Anna 用它"), Chinese ones don't ("让马克君用它"). */
const whoInline = computed(() => /^[\w .-]+$/.test(who.value) ? ` ${who.value} ` : who.value)
const mine = computed(() => agents.value.mine[current.value] ?? [])
const inUse = computed(() => agents.value.providers[current.value]?.provider)
/** Providers to fall back on, in order (Claude Code and Codex: Anna's routing does the switching). */
const backups = computed(() => agents.value.providers[current.value]?.backups ?? [])
const canBackUp = computed(() => current.value !== 'gemini')
function setBackups(names: string[]) {
  if (current.value !== 'gemini')
    emit('command', { type: 'provider-backups', app: current.value, names })
}
function moveBackup(name: string, by: number) {
  const list = [...backups.value]
  const from = list.indexOf(name)
  const to = from + by
  if (from < 0 || to < 0 || to >= list.length)
    return
  list.splice(to, 0, ...list.splice(from, 1))
  setBackups(list)
}
const healthLabels = { open: '暂停中', half_open: '试探恢复中' }
const healthTitles = { open: '连续出错，暂停使用一会儿，之后会自动试探', half_open: '暂停结束，正在用一个请求试探它恢复了没有' }
const global = computed(() => agents.value.global[current.value])

/** The add/edit form: `previous` is set while editing, `from` when starting from a preset. */
type ApiFormat = 'anthropic' | 'openai_responses' | 'openai_chat'
const editor = ref<{ previous?: string, from?: string, name: string, baseUrl: string, model: string, key: string, apiKeyUrl?: string, website?: string, apiFormat: ApiFormat }>()
/** The protocol the agent speaks itself; Chat Completions goes through Anna's local routing. */
const nativeFormat = computed<ApiFormat>(() => current.value === 'codex' ? 'openai_responses' : 'anthropic')
const nativeLabel: Record<App, string> = { claude: 'Anthropic Messages', codex: 'OpenAI Responses', gemini: 'Gemini' }
const search = ref('')
const removing = ref<string>()
/** Writing a provider by hand instead of picking a preset. */
const custom = ref(false)
const results = computed(() => {
  const query = search.value.trim().toLowerCase()
  const list = (agents.value.presets[current.value] ?? []).filter(preset => !preset.official)
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
  editor.value = { name: '', baseUrl: '', model: '', key: '', apiFormat: nativeFormat.value }
}
function pick(preset: PresetSummary) {
  editor.value = { from: preset.name, name: mine.value.some(item => item.name === preset.name) ? `${preset.name} 2` : preset.name, baseUrl: preset.baseUrl ?? '', model: preset.model ?? '', key: '', apiKeyUrl: preset.apiKeyUrl, website: preset.website, apiFormat: preset.routed ? 'openai_chat' : nativeFormat.value }
}
function edit(provider: MyProvider) {
  removing.value = undefined
  editor.value = { previous: provider.name, name: provider.name, baseUrl: provider.baseUrl ?? '', model: provider.model ?? '', key: '', apiKeyUrl: provider.apiKeyUrl, website: provider.website, apiFormat: provider.routed ? 'openai_chat' : nativeFormat.value }
}
function save() {
  const draft = editor.value!
  emit('command', { type: 'provider-save', app: current.value, name: draft.name, previous: draft.previous, from: draft.from, baseUrl: draft.baseUrl, model: draft.model, key: draft.key || undefined, ...(current.value !== 'gemini' ? { apiFormat: draft.apiFormat } : {}) })
  editor.value = undefined
}
const use = (name?: string) => emit('command', { type: 'agent-provider', agent: current.value, provider: name })
const pending = computed(() => agents.value.pendingImport)
const linkOpen = ref(false)
const link = ref('')
const exportKeys = ref(false)
const speed = (name: string) => agents.value.speed?.[`${current.value}:${name}`]
const usage = (name: string) => agents.value.usage?.[`${current.value}:${name}`]
/** The provider whose balance or quota is being looked up; cleared when the answer arrives. */
const checking = ref<string>()
watch(() => agents.value.usage, () => { checking.value = undefined })
function checkUsage(name: string) {
  checking.value = name
  emit('command', { type: 'provider-usage', app: current.value, name })
}
const money = (amount: number, unit: string) => `${unit === 'CNY' ? '¥' : unit === 'USD' ? '$' : `${unit} `}${amount.toFixed(2)}`
/** "今天 18:00" / "10月21日 09:00" */
function resets(iso: string) {
  const date = new Date(iso)
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return date.toDateString() === new Date().toDateString() ? `今天 ${time} ` : `${date.getMonth() + 1}月${date.getDate()}日 ${time} `
}
/** The provider being timed; cleared when its results arrive. */
const testing = ref<string>()
watch(() => agents.value.speed, () => { testing.value = undefined })
function speedtest(name: string) {
  testing.value = name
  emit('command', { type: 'provider-speedtest', app: current.value, name })
}
</script>

<template>
  <div class="providers">
    <p class="small muted">派活或把它当大脑时，Anna 只给那个 agent 的进程注入这里选的服务商，不改你的配置文件；给 Claude Code 或 Codex 设了备用服务商的话，正在用的出错时会按顺序换用。“应用到全局”才会像 cc-switch 一样写入它的配置：只改连接相关的字段，首次写入前会备份，可以一键恢复。预设来自 cc-switch（MIT）。</p>
    <div class="card-actions left provider-tools">
      <button :disabled="locked" @click="linkOpen = !linkOpen">从链接导入</button>
      <button :disabled="locked" @click="emit('command', { type: 'providers-import' })">导入文件</button>
      <button :disabled="locked" @click="emit('command', { type: 'providers-export', includeKeys: exportKeys })">导出</button>
      <label class="check small"><input v-model="exportKeys" type="checkbox" aria-label="导出时包含密钥">含密钥</label>
    </div>
    <p v-if="exportKeys" class="small warn">导出的文件里会有明文密钥，只给你自己的设备用，别发给别人。</p>
    <form v-if="linkOpen && !pending" class="link-import" @submit.prevent="emit('command', { type: 'provider-link', link }); link = ''">
      <input v-model="link" required aria-label="导入链接" placeholder="粘贴 anna:// 或 ccswitch:// 开头的导入链接">
      <button type="submit" :disabled="locked">识别</button>
    </form>
    <section v-if="pending" class="card approval-request link-confirm" role="alert" aria-label="确认导入">
      <strong>导入 {{ labels[pending.app] }} 服务商：{{ pending.name }}</strong>
      <dl class="small">
        <dt>请求地址</dt><dd>{{ pending.baseUrl }}<template v-if="pending.endpoints.length">（另有 {{ pending.endpoints.length }} 个备用地址）</template></dd>
        <dt>API Key</dt><dd>{{ pending.key }}</dd>
        <template v-if="pending.model"><dt>模型</dt><dd>{{ pending.model }}</dd></template>
        <template v-if="pending.apiFormat"><dt>接口</dt><dd>Chat Completions，经 Anna 本地路由</dd></template>
        <template v-if="pending.tiers"><dt>Haiku / Sonnet / Opus</dt><dd>{{ [pending.tiers.haiku, pending.tiers.sonnet, pending.tiers.opus].map(item => item ?? '—').join(' / ') }}</dd></template>
        <template v-if="pending.website"><dt>网站</dt><dd>{{ pending.website }}</dd></template>
      </dl>
      <p v-for="warning in pending.warnings" :key="warning" class="small warn">⚠ {{ warning }}</p>
      <p class="small muted">密钥会发到上面的地址。只导入你信任的网站给的链接。</p>
      <div class="card-actions">
        <button @click="emit('command', { type: 'provider-link-cancel' })">取消</button>
        <button :class="{ primary: !pending.enabled }" :disabled="locked" @click="emit('command', { type: 'provider-link-confirm', use: false })">导入</button>
        <button :class="{ primary: pending.enabled }" :disabled="locked" @click="emit('command', { type: 'provider-link-confirm', use: true })">导入并让{{ whoInline }}用它</button>
      </div>
    </section>
    <div class="app-tabs" role="tablist" aria-label="选择 agent">
      <button v-for="id in apps" :key="id" role="tab" :aria-selected="app === id" :data-app="id" @click="app = id; editor = undefined; removing = undefined">{{ labels[id] }}</button>
      <button role="tab" :aria-selected="app === 'universal'" data-app="universal" @click="app = 'universal'; editor = undefined">统一</button>
    </div>
    <UniversalPanel v-if="app === 'universal'" :snapshot="snapshot" :locked="locked" @command="emit('command', $event)" />
    <template v-else>
      <p class="small status-line" :data-app="current">{{ who }} 用：<strong>{{ inUse ?? '它自己的登录' }}</strong><template v-if="backups.length"> · 出错时换用：{{ backups.join(' → ') }}</template> · 全局：{{ global?.switched ? `已切换到 ${global.provider}` : '未修改' }}<button v-if="global?.switched" class="link" :disabled="locked" @click="emit('command', { type: 'provider-restore', app: current })">恢复原配置</button></p>

      <ul v-if="!editor" class="provider-list" :aria-label="`${labels[current]} 的服务商`">
        <li :class="{ current: !inUse }" data-provider="">
          <div class="agent-main"><strong>它自己的登录</strong><span v-if="!inUse" class="badge ok">{{ who }} 正在用</span></div>
          <p class="small muted">用 {{ labels[current] }} 自己登录的账号和配置。</p>
          <div class="card-actions left"><button v-if="inUse" :disabled="locked" @click="use(undefined)">让{{ whoInline }}用它</button></div>
        </li>
        <li v-for="provider in mine" :key="provider.name" :class="{ current: inUse === provider.name }" :data-provider="provider.name">
          <div class="agent-main">
            <strong>{{ provider.name }}</strong>
            <span class="badge muted-badge">{{ sources[provider.source] }}</span>
            <span v-if="inUse === provider.name" class="badge ok">{{ who }} 正在用</span>
            <span v-if="global?.switched && global.provider === provider.name" class="badge">全局</span>
            <span class="badge" :class="provider.hasKey ? 'ok' : 'warn'">{{ provider.hasKey ? '已存密钥' : '没有密钥' }}</span>
            <span v-if="provider.routed" class="badge" :title="`${labels[current]} 经 Anna 的本地路由连接它，真实密钥只留在 Anna 里`">经本地路由</span>
            <span v-if="backups.includes(provider.name)" class="badge" :data-backup="backups.indexOf(provider.name) + 1">备用 {{ backups.indexOf(provider.name) + 1 }}</span>
            <span v-if="provider.health" class="badge warn" :title="healthTitles[provider.health]">{{ healthLabels[provider.health] }}</span>
          </div>
          <p class="small muted">{{ host(provider.baseUrl) || '未设置地址' }}{{ provider.model ? ` · ${provider.model}` : '' }}</p>
          <div v-if="removing === provider.name" class="card approval-request" role="alert">
            <strong>删除 {{ provider.name }}？</strong>
            <p class="small muted">它的密钥会一起删掉。{{ inUse === provider.name ? `${who} 会改用它自己的登录。` : '' }}已经应用到全局的配置不会动，需要的话先“恢复原配置”。</p>
            <div class="card-actions"><button @click="removing = undefined">取消</button><button class="primary" :disabled="locked" @click="emit('command', { type: 'provider-delete', app: current, name: provider.name }); removing = undefined">删除</button></div>
          </div>
          <div v-else class="card-actions left">
            <button v-if="inUse !== provider.name" :disabled="locked" @click="use(provider.name)">让{{ whoInline }}用它</button>
            <template v-if="canBackUp && inUse !== provider.name">
              <button v-if="!backups.includes(provider.name)" :disabled="locked" title="正在用的服务商出错时，Anna 按顺序换用备用服务商" @click="setBackups([...backups, provider.name])">设为备用</button>
              <template v-else>
                <button class="link" :disabled="locked || backups.indexOf(provider.name) === 0" aria-label="备用顺序上移" @click="moveBackup(provider.name, -1)">↑</button>
                <button class="link" :disabled="locked || backups.indexOf(provider.name) === backups.length - 1" aria-label="备用顺序下移" @click="moveBackup(provider.name, 1)">↓</button>
                <button class="link" :disabled="locked" @click="setBackups(backups.filter(name => name !== provider.name))">移出备用</button>
              </template>
            </template>
            <button :disabled="locked || !provider.hasKey || provider.routed" :title="provider.routed ? '经本地路由的服务商现在只能在 Anna 里用' : provider.hasKey ? '' : '先存一个密钥'" @click="emit('command', { type: 'provider-global', app: current, provider: provider.name })">应用到全局</button>
            <button v-if="provider.usage" :disabled="locked || !provider.hasKey || checking === provider.name" :title="provider.hasKey ? '' : '先存一个密钥'" @click="checkUsage(provider.name)">{{ checking === provider.name ? '查询中…' : provider.usage === 'quota' ? '查额度' : '查余额' }}</button>
            <button :disabled="locked || testing === provider.name" @click="speedtest(provider.name)">{{ testing === provider.name ? '测速中…' : '测速' }}</button>
            <template v-if="provider.source !== 'universal'">
              <button :disabled="locked" @click="edit(provider)">编辑</button>
              <button class="link danger-link" :disabled="locked" @click="removing = provider.name">删除</button>
            </template>
            <button v-else class="link" @click="app = 'universal'">在“统一”里修改</button>
          </div>
          <p v-if="usage(provider.name)" class="usage-line small" :class="{ warn: usage(provider.name)!.error }" :data-usage="provider.name">
            <template v-if="usage(provider.name)!.error">{{ usage(provider.name)!.error }}</template>
            <template v-else>
              <span v-if="usage(provider.name)!.plan" class="badge">{{ usage(provider.name)!.plan }}</span>
              <span v-for="balance in usage(provider.name)!.balances" :key="balance.label" class="badge" :class="balance.remaining > 0 ? 'ok' : 'warn'">余额 {{ money(balance.remaining, balance.unit) }}</span>
              <span v-for="item in usage(provider.name)!.windows" :key="item.window" class="badge" :class="item.usedPercent >= 90 ? 'warn' : 'ok'">{{ item.window === 'five_hour' ? '5 小时' : '本周' }}剩 {{ Math.max(0, Math.round(100 - item.usedPercent)) }}%{{ item.resetsAt ? `，${resets(item.resetsAt)}重置` : '' }}</span>
              <span v-if="!usage(provider.name)!.balances?.length && !usage(provider.name)!.windows?.length" class="muted">没有查到额度信息</span>
            </template>
          </p>
          <ul v-if="speed(provider.name)" class="speed-results" :aria-label="`${provider.name} 的测速结果`">
            <li v-for="result in speed(provider.name)!.results" :key="result.url" :data-url="result.url">
              <span class="speed-url">{{ result.url.replace(/^https?:\/\//, '') }}</span>
              <span class="badge" :class="result.latency === undefined ? 'warn' : result.latency < 300 ? 'ok' : ''">{{ result.latency === undefined ? result.error : `${result.latency} ms` }}</span>
              <span v-if="result.url === provider.baseUrl" class="small muted">正在用</span>
              <button v-else-if="result.latency !== undefined && provider.source !== 'universal'" class="link" :disabled="locked" @click="emit('command', { type: 'provider-save', app: current, name: provider.name, previous: provider.name, baseUrl: result.url })">用这个</button>
            </li>
            <li class="small muted">从这台电脑直接连接测得，{{ new Date(speed(provider.name)!.at).toLocaleTimeString() }}</li>
          </ul>
        </li>
      </ul>
      <button v-if="!editor" class="add-provider" :disabled="locked" @click="startAdd">＋ 添加服务商</button>

      <section v-if="editor && !editor.previous && !editor.from && !custom" class="preset-picker" aria-label="选择预设">
        <div class="sheet-heading"><h3>添加 {{ labels[current] }} 服务商</h3><button class="link" @click="editor = undefined">取消</button></div>
        <input v-model="search" type="search" aria-label="搜索预设" placeholder="搜索名称或域名，例如 DeepSeek、kimi、openrouter.ai">
        <button class="preset-custom" @click="custom = true">自定义：自己填地址和模型</button>
        <div v-for="group in grouped" :key="group.category" class="preset-group">
          <h4>{{ group.label }}</h4>
          <button v-for="preset in group.presets" :key="preset.name" class="preset-item" :data-preset="preset.name" @click="pick(preset)"><strong>{{ preset.name }}</strong><span>{{ host(preset.baseUrl) }}{{ preset.routed ? ' · 经本地路由' : '' }}</span></button>
        </div>
        <p v-if="!results.length" class="small muted">没有找到，可以用“自定义”。</p>
      </section>

      <form v-else-if="editor" class="provider-editor" @submit.prevent="save(); custom = false">
        <div class="sheet-heading"><h3>{{ editor.previous ? `编辑 ${editor.previous}` : editor.from ? `添加 ${editor.from}` : '自定义服务商' }}</h3><button type="button" class="link" @click="editor = undefined; custom = false">取消</button></div>
        <label>名称<input v-model="editor.name" required maxlength="60" aria-label="服务商名称"></label>
        <label v-if="current !== 'gemini'">接口<select v-model="editor.apiFormat" aria-label="接口格式"><option :value="nativeFormat">{{ nativeLabel[current] }}（直连）</option><option value="openai_chat">Chat Completions（经本地路由）</option></select></label>
        <label>请求地址<input v-model="editor.baseUrl" :required="!editor.from && !editor.previous" aria-label="请求地址" :placeholder="current === 'gemini' ? 'https://…' : editor.apiFormat === 'openai_chat' ? (current === 'codex' ? 'https://…/v1（Chat Completions 接口）' : 'https://…（Chat Completions 接口，会补上 /v1/chat/completions）') : `https://…（${nativeLabel[current]} 接口）`"></label>
        <label>模型<input v-model="editor.model" :required="current === 'codex' && !editor.from && !editor.previous" aria-label="模型" placeholder="留空用预设的默认模型"></label>
        <label>API Key<input v-model="editor.key" type="password" autocomplete="off" aria-label="API Key" :placeholder="editor.previous && mine.find(item => item.name === editor!.previous)?.hasKey ? '已保存，留空保持' : '输入服务商密钥'"></label>
        <a v-if="editor.apiKeyUrl" class="link small" :href="editor.apiKeyUrl" target="_blank" rel="noreferrer">去获取密钥 ↗</a>
        <p v-if="current !== 'gemini' && editor.apiFormat === 'openai_chat'" class="small muted">{{ labels[current] }} 只说 {{ nativeLabel[current] }} 接口，Anna 在本机替它转换成 Chat Completions。真实密钥只留在 Anna 里，{{ labels[current] }} 每次只拿到一个用完即废的令牌。这类服务商暂时只能在 Anna 里用，不能应用到全局。</p>
        <div class="card-actions"><button type="submit" class="primary" :disabled="locked">保存</button></div>
      </form>
    </template>
  </div>
</template>
