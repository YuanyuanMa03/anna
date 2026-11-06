<script setup lang="ts">
import type { Command, ModelSettings, RuntimeSnapshot } from '../../../packages/shared/contracts'
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { brainChoices } from '../../../packages/agents/brains'
import { catalog } from '../../../packages/agents/catalog'
import { installationGuide } from '../../../packages/agents/installation'
import { companion } from '../../../packages/character/manifest'
import { modelVendors, sameEndpoint, vendorFor, vendorSettings } from '../../../packages/shared/model-vendors'
import ProvidersPanel from './components/providers-panel.vue'

const props = defineProps<{ snapshot: RuntimeSnapshot, busy: boolean, inline?: boolean, section?: 'brain' | 'connection' }>()
const emit = defineEmits<{ command: [command: Command], close: [] }>()
const model = reactive<ModelSettings>({ ...props.snapshot.settings.model })
const key = ref('')
const search = ref('')
const showBrains = ref(false)
const sharingPreview = ref(false)
const shareTargets = computed(() => props.snapshot.settings.model.api === 'openai-completions' ? 'Claude Code、Codex' : props.snapshot.settings.model.api === 'anthropic-messages' ? 'Claude Code（跳过 Codex：协议不兼容）' : 'Codex（跳过 Claude Code：协议不兼容）')
const source = ref<'official' | 'api'>(props.snapshot.agents.providers[props.snapshot.settings.kernel === 'claude-code' ? 'claude' : props.snapshot.settings.kernel]?.provider ? 'api' : 'official')
const selectedAgent = computed(() => props.snapshot.settings.kernel === 'claude-code' ? 'claude' : props.snapshot.settings.kernel.replace('acp:', ''))
/** The same choices as the brain chip; pi stays selectable without a model, since its model is set up right below. */
const brains = computed(() => brainChoices({ detected: props.snapshot.agents.detected, current: props.snapshot.settings.kernel, hasKey: props.snapshot.hasKey, sandbox: props.snapshot.platform.sandbox.available, acp: props.snapshot.platform.acp }).map(choice => ({ ...choice, available: choice.state !== 'missing' })))
const cards = computed(() => [
  ...brains.value.map(brain => ({ ...brain, agent: brain.id === 'claude-code' ? 'claude' : brain.id.replace('acp:', ''), install: catalog.find(agent => agent.id === (brain.id === 'claude-code' ? 'claude' : brain.id.replace('acp:', '')))?.install })),
  ...catalog.filter(agent => agent.id !== 'pi' && !brains.value.some(brain => brain.id === agent.id || brain.id === `acp:${agent.id}` || (agent.id === 'claude' && brain.id === 'claude-code'))).map((agent) => {
    const detected = props.snapshot.agents.detected.find(item => item.id === agent.id)
    return { id: `acp:${agent.id}`, agent: agent.id, label: agent.label, available: false, install: agent.install, note: !detected?.installed ? '未安装' : agent.acp ? '已安装 · 实验接入未开启' : '已识别 · 大脑尚未适配' }
  }),
].sort((a, b) => a.id === 'pi' ? -1 : b.id === 'pi' ? 1 : Number(b.available) - Number(a.available) || Number(Boolean(props.snapshot.agents.detected.find(item => item.id === b.agent)?.installed)) - Number(Boolean(props.snapshot.agents.detected.find(item => item.id === a.agent)?.installed))))
const installConfirm = ref<string>()
const guide = computed(() => { const agent = catalog.find(agent => agent.id === installConfirm.value); return agent ? installationGuide(agent, props.snapshot.platform.os) : undefined })
function selectBrain(id: string) {
  source.value = 'official'
  emit('command', { type: 'kernel', id: id as RuntimeSnapshot['settings']['kernel'] })
}

function save() { emit('command', { type: 'configure', model: { ...model, model: model.model.trim() }, key: key.value }); key.value = '' }

/** Vendor tiles, then a custom endpoint; DeepSeek stays on pi's own catalogue. */
const vendorTiles = [...modelVendors, { id: 'custom', label: '自定义', hint: '兼容 OpenAI / Anthropic 的端点' }]
const vendorId = ref(vendorFor(props.snapshot.settings.model)?.id ?? 'custom')
const vendor = computed(() => modelVendors.find(item => item.id === vendorId.value))
/** The saved key may only go back to the address it was saved for. */
const savedKeyFits = computed(() => props.snapshot.hasKey && sameEndpoint(props.snapshot.settings.model.baseURL, model.baseURL))
const list = computed(() => props.snapshot.modelList && sameEndpoint(props.snapshot.modelList.baseURL, model.baseURL) && props.snapshot.modelList.api === model.api ? props.snapshot.modelList : undefined)
const choices = computed(() => [...new Set([...(list.value?.models ?? []), ...(vendor.value?.models ?? [])])])
const requested = ref<string>()
const listing = computed(() => requested.value !== undefined && (!props.snapshot.modelList || props.snapshot.modelList.at < requested.value))
let timer: ReturnType<typeof setTimeout> | undefined
function fetchModels() {
  clearTimeout(timer)
  if (!model.baseURL || (!key.value.trim() && !savedKeyFits.value))
    return
  const at = new Date().toISOString()
  requested.value = at
  // A command the host refuses outright never answers with a list; stop showing progress after a while.
  setTimeout(() => {
    if (requested.value === at)
      requested.value = undefined
  }, 20_000)
  emit('command', { type: 'model-list', model: { baseURL: model.baseURL, api: model.api }, ...(key.value.trim() ? { key: key.value.trim() } : {}) })
}
/** Typing a key fetches the list once the user pauses. */
function scheduleList() {
  clearTimeout(timer)
  if (key.value.trim().length >= 8)
    timer = setTimeout(fetchModels, 800)
}
function pickVendor(id: string) {
  vendorId.value = id
  const picked = modelVendors.find(item => item.id === id)
  if (picked)
    Object.assign(model, vendorSettings(picked, picked.models[0] ?? ''))
  else
    model.provider = 'custom'
  key.value = ''
  if (picked && savedKeyFits.value)
    fetchModels()
}
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div :class="inline ? 'connection-inline' : 'sheet-backdrop'" @click.self="!inline && emit('close')">
    <section :class="{ sheet: !inline }" :role="inline ? undefined : 'dialog'" :aria-modal="inline ? undefined : true" aria-label="模型与设置">
      <div v-if="!inline" class="sheet-heading"><div><span class="eyebrow">CONNECTION</span><h2>让 {{ companion(snapshot.settings.characterId).name }} 开始思考</h2></div><button aria-label="关闭设置" class="icon-button" @click="emit('close')">×</button></div>
      <template v-if="section !== 'connection'">
        <h3>{{ companion(snapshot.settings.characterId).name }} 的大脑</h3>
        <p class="muted small">大脑负责思考和使用工具，模型提供推理能力。pi 已内置；其他大脑需要安装对应软件。</p>
        <button @click="showBrains = !showBrains">{{ showBrains ? '收起其他大脑' : '选择其他大脑' }}</button><label v-if="showBrains">搜索大脑<input v-model="search"></label><div class="brain-cards" role="radiogroup" aria-label="Anna 的大脑">
          <div v-for="brain in cards.filter(card => (showBrains || card.id === snapshot.settings.kernel) && card.label.toLowerCase().includes(search.toLowerCase()))" :key="brain.id" class="brain-tile" :class="{ unavailable: !brain.available }">
            <button type="button" role="radio" :aria-checked="snapshot.settings.kernel === brain.id" :disabled="busy || !brain.available" @click="selectBrain(brain.id)"><span class="brain-symbol">{{ brain.label.slice(0, 2) }}</span><strong>{{ brain.label }}</strong><small>{{ brain.id === 'pi' ? '默认 · 内置框架' : brain.note }}</small></button>
            <button v-if="brain.id !== 'pi' && !snapshot.agents.detected.find(agent => agent.id === brain.agent)?.installed" class="link" :disabled="busy" @click="installConfirm = brain.agent">安装说明</button>
          </div>
        </div>
        <div v-if="installConfirm" class="card" role="status">
          <strong>安装 {{ catalog.find(agent => agent.id === installConfirm)?.label }}</strong>
          <p v-if="guide?.command">{{ snapshot.platform.os === 'win32' ? '在开始菜单搜索并打开 PowerShell' : snapshot.platform.os === 'darwin' ? '打开“应用程序 → 实用工具 → 终端”' : '从应用菜单打开终端' }}，按官方说明运行以下命令。</p><p v-else>前往官方说明，选择适合当前系统的安装包或安装方法。</p><pre v-if="guide?.command">{{ guide.command }}</pre><p v-if="guide?.needsNode" class="small muted">这条命令需要先安装 Node.js 与 npm，可从 <a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer">Node.js 官网</a>获取。</p><p v-if="guide?.url"><a :href="guide.url" target="_blank" rel="noreferrer">查看官方安装说明</a></p>
          <p class="small muted">安装完成后重新检测。标记为“待适配”的大脑仍需接入验证，安装不会自动解锁。</p>
          <button :disabled="busy" @click="emit('command', { type: 'agents-refresh' }); installConfirm = undefined">我已安装，重新检测</button><button @click="installConfirm = undefined">收起</button>
        </div>
        <button :disabled="busy" @click="emit('command', { type: 'agents-refresh' })">重新检测本机大脑</button>
      </template>
      <template v-if="section !== 'brain'">
        <template v-if="snapshot.settings.kernel !== 'pi'">
          <h3>{{ snapshot.kernel.label }} 使用什么模型？</h3>
          <div class="card-actions left"><button :aria-pressed="source === 'official'" :disabled="busy" @click="source = 'official'; ['claude', 'codex', 'gemini'].includes(selectedAgent) && emit('command', { type: 'agent-provider', agent: selectedAgent })">使用已有登录 / 配置</button><button :aria-pressed="source === 'api'" @click="source = 'api'">其他模型厂商 API</button></div>
          <p v-if="source === 'official'" class="muted small">使用该 agent 自己保存的登录或配置。未登录时，请先在终端打开该 agent 按提示登录；官方订阅与 API 余额可能分别计费。</p>
          <ProvidersPanel v-else-if="['claude', 'codex', 'gemini'].includes(selectedAgent)" :key="selectedAgent" :snapshot="snapshot" :locked="busy" @command="emit('command', $event)" />
          <p v-else class="muted small">这个大脑暂时使用自己的模型配置，请在对应 agent 中设置服务商。</p>
        </template>
        <template v-if="snapshot.settings.kernel === 'pi'">
          <h3>pi 的模型</h3>
          <p class="small muted">选一家模型厂商，填入它的 API Key，Anna 会去取这个 Key 能用的模型。密钥加密保存在本机，只发给你选的这家厂商；发送任务时会把任务内容交给所选模型。API Key 不同于网站的登录密码。</p>
          <div class="brain-cards vendor-cards" role="radiogroup" aria-label="模型厂商">
            <button v-for="tile in vendorTiles" :key="tile.id" type="button" role="radio" class="personality-card vendor-card" :aria-checked="vendorId === tile.id" :disabled="busy" @click="pickVendor(tile.id)"><strong>{{ tile.label }}</strong><small>{{ tile.hint }}</small></button>
          </div>
          <form @submit.prevent="save">
            <template v-if="vendorId === 'custom'">
              <label>API 协议<select v-model="model.api"><option value="anthropic-messages">Anthropic Messages</option><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option></select></label>
              <label>API 端点<input v-model="model.baseURL" type="url" required aria-label="API 端点"></label>
            </template>
            <p v-else-if="vendor" class="small"><a :href="vendor.keyPage" target="_blank" rel="noreferrer">去 {{ vendor.label }} 领取 API Key</a></p>
            <label>API Key<input v-model="key" type="password" autocomplete="off" :placeholder="savedKeyFits ? '已保存，留空保持原密钥' : '输入这个服务的 API Key'" aria-label="API Key" @input="scheduleList"></label>
            <div class="card-actions left"><button type="button" :disabled="busy || listing || (!key.trim() && !savedKeyFits) || !model.baseURL" @click="fetchModels">{{ listing ? '正在获取模型…' : '获取模型列表' }}</button></div>
            <p v-if="list?.error" class="error small" role="alert">{{ list.error }}</p>
            <p v-else-if="list" class="small muted">这个 Key 可以用 {{ list.models.length }} 个模型{{ list.models.length ? '，可以在下面搜索或选择' : '' }}。</p>
            <label>模型<input v-model="model.model" required aria-label="模型 ID" list="models" placeholder="搜索或填写模型 ID"><datalist id="models"><option v-for="id in choices" :key="id" :value="id" /></datalist></label>
            <div v-if="vendor?.models.length" class="card-actions left"><span class="small muted">推荐：</span><button v-for="id in vendor.models" :key="id" type="button" :aria-pressed="model.model === id" @click="model.model = id">{{ id }}</button></div>
            <button class="primary" :disabled="busy || !model.model.trim() || (!key.trim() && !savedKeyFits)" type="submit">保存并连接</button>
          </form>
        </template>
        <h3>共用 pi 的模型</h3>
        <p class="small muted">Chat Completions 模型可供 Claude Code、Codex 共用；Anthropic 协议仅供 Claude Code，Responses 仅供 Codex。只切换 Anna 内的大脑和派活配置，终端配置由服务商页单独管理。</p>
        <div v-if="sharingPreview" class="card"><p>将跟随 pi：{{ shareTargets }}。其余大脑尚未适配，将跳过。</p><p class="small muted">仅影响 Anna 内调用。首次保存原选择，可恢复；手动选择其他服务商后退出跟随。</p><button :disabled="busy" @click="emit('command', { type: 'share-pi-model' }); sharingPreview = false">确认应用</button><button @click="sharingPreview = false">取消</button></div>
        <div class="card-actions left"><button :disabled="busy || !snapshot.hasKey" @click="sharingPreview = true">一键共用 pi 模型</button><button v-if="snapshot.settings.sharedModelBackup" :disabled="busy" @click="emit('command', { type: 'share-pi-model', restore: true })">恢复切换前的模型选择</button></div>
        <button :disabled="busy || (!snapshot.hasKey && snapshot.settings.kernel === 'pi')" @click="emit('command', { type: 'connection-test' })">验证连接（少量调用）</button>
        <p class="muted small">连接状态：{{ snapshot.state }}<template v-if="snapshot.model"> · {{ snapshot.model.id }}</template><template v-else-if="snapshot.settings.kernel === 'pi' && snapshot.hasKey"> · {{ snapshot.settings.model.model }}</template><template v-if="snapshot.credential"> · 密钥{{ snapshot.credential === 'verified' ? '已验证可用' : snapshot.credential === 'rejected' ? '被服务商拒绝' : '还没验证过（发一条消息或点“验证连接（少量调用）”）' }}</template>{{ snapshot.model ? ` · 思考 ${snapshot.model.thinking} · 上下文 ${Math.round(snapshot.model.contextWindow / 1000)}K` : '' }}<br>会话：{{ snapshot.sessionId ?? '首次对话后保存' }}<br>{{ snapshot.restored ? '已恢复上次的 pi 会话' : '新会话' }}</p>
        <button :disabled="busy" @click="emit('command', { type: 'new-session' })">开始新会话</button>
        <p class="muted small">新会话会清空当前界面的对话，旧会话文件继续保留。长任务会自动压缩上下文。</p>
      </template>
    </section>
  </div>
</template>
