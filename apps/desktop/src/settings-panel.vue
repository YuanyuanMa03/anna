<script setup lang="ts">
import type { Command, ModelSettings, RuntimeSnapshot } from '../../../packages/shared/contracts'
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { brainChoices } from '../../../packages/agents/brains'
import { catalog } from '../../../packages/agents/catalog'
import { installSteps } from '../../../packages/agents/installation'
import { companion } from '../../../packages/character/manifest'
import { firstModel, listsModels, modelVendors, sameEndpoint, vendorFor, vendorSettings } from '../../../packages/shared/model-vendors'
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
const guide = computed(() => { const agent = catalog.find(agent => agent.id === installConfirm.value); return agent ? installSteps(agent, props.snapshot.platform.os) : undefined })
const copied = ref<'done' | 'failed'>()
const guideAgent = computed(() => installConfirm.value ?? '')
const guideCard = ref<HTMLElement>()
const guideTitle = ref<HTMLElement>()
let copyTimer: ReturnType<typeof setTimeout> | undefined
async function copyCommand(command: string) {
  try {
    await navigator.clipboard.writeText(command)
    copied.value = 'done'
  }
  catch {
    copied.value = 'failed'
  }
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copied.value = undefined }, 2500)
}
// The guide opens below the cards: bring it into view and focus its title, so the click visibly does something.
watch(installConfirm, async (agent) => {
  copied.value = undefined
  if (!agent)
    return
  await nextTick()
  guideCard.value?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  guideTitle.value?.focus({ preventScroll: true })
})
function selectBrain(id: string) {
  source.value = 'official'
  emit('command', { type: 'kernel', id: id as RuntimeSnapshot['settings']['kernel'] })
}

function save() { emit('command', { type: 'configure', model: { ...model, model: model.model.trim() }, key: key.value }); key.value = '' }

/** Vendor tiles, then a custom endpoint; DeepSeek stays on pi's own catalogue. */
const vendorTiles = [...modelVendors, { id: 'custom', label: '自定义', hint: '兼容 OpenAI / Anthropic 的端点' }]
const vendorId = ref(vendorFor(props.snapshot.settings.model)?.id ?? 'custom')
const vendor = computed(() => modelVendors.find(item => item.id === vendorId.value))
/** Every vendor but DeepSeek, whose models come from pi's own catalogue, and a custom endpoint can list models. */
const canList = computed(() => !vendor.value || listsModels(vendor.value))
/** The saved key may only go back to the address it was saved for. */
const savedKeyFits = computed(() => props.snapshot.hasKey && sameEndpoint(props.snapshot.settings.model.baseURL, model.baseURL))
const list = computed(() => canList.value && props.snapshot.modelList && sameEndpoint(props.snapshot.modelList.baseURL, model.baseURL) && props.snapshot.modelList.api === model.api ? props.snapshot.modelList : undefined)
const choices = computed(() => [...new Set([...(vendor.value?.models ?? []), ...(list.value?.models ?? [])])])
const requested = ref<string>()
const listing = computed(() => requested.value !== undefined && (!props.snapshot.modelList || props.snapshot.modelList.at < requested.value))
let timer: ReturnType<typeof setTimeout> | undefined
let fallback: ReturnType<typeof setTimeout> | undefined
function fetchModels() {
  clearTimeout(timer)
  if (!canList.value || !model.baseURL || (!key.value.trim() && !savedKeyFits.value))
    return
  const at = new Date().toISOString()
  requested.value = at
  // If the command itself fails, no list arrives; stop showing progress after a while.
  clearTimeout(fallback)
  fallback = setTimeout(() => {
    if (requested.value === at)
      requested.value = undefined
  }, 20_000)
  emit('command', { type: 'model-list', model: { baseURL: model.baseURL, api: model.api }, ...(key.value.trim() ? { key: key.value.trim() } : {}) })
}
/** Typing a key fetches the list once the user pauses. */
function scheduleList() {
  clearTimeout(timer)
  if (canList.value && key.value.trim().length >= 8)
    timer = setTimeout(fetchModels, 800)
}
function pickVendor(id: string) {
  const previous = vendorId.value
  vendorId.value = id
  const picked = modelVendors.find(item => item.id === id)
  if (picked) {
    Object.assign(model, vendorSettings(picked, picked.models[0] ?? ''))
  }
  else {
    // pi's catalogue names (DeepSeek's) mean nothing to a custom endpoint.
    if (previous === 'deepseek')
      model.model = ''
    model.provider = 'custom'
  }
  key.value = ''
  requested.value = undefined
  if (savedKeyFits.value)
    fetchModels()
}
// A list that arrives for an empty model box fills it, so a vendor without suggestions still ends up with a model.
watch(() => list.value?.at, () => {
  if (list.value)
    model.model = firstModel(model.model, list.value.models, vendor.value?.models ?? [])
})
// Settings changed elsewhere (a save, another window): show them, and their tile.
watch(() => JSON.stringify(props.snapshot.settings.model), () => {
  // A key typed for the old address must not follow the form to the new one.
  key.value = ''
  requested.value = undefined
  clearTimeout(timer)
  Object.assign(model, props.snapshot.settings.model)
  vendorId.value = vendorFor(props.snapshot.settings.model)?.id ?? 'custom'
})
onBeforeUnmount(() => { clearTimeout(timer); clearTimeout(fallback); clearTimeout(copyTimer) })
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
        <div v-if="installConfirm && guide" ref="guideCard" class="card install-guide" role="region" :aria-label="`安装 ${catalog.find(agent => agent.id === installConfirm)?.label}`">
          <strong ref="guideTitle" tabindex="-1">安装 {{ catalog.find(agent => agent.id === installConfirm)?.label }}</strong>
          <p v-if="guide.oneClick" class="small">最简单的办法：电脑上已有 Node.js 的话，直接<button type="button" class="link" :disabled="busy" @click="emit('command', { type: 'agent-install', agent: guideAgent })">让 Anna 帮你装</button>。</p>
          <ol class="install-steps"><li v-for="(step, index) in guide.steps" :key="index">{{ step }}</li></ol>
          <div v-if="guide.command" class="install-command"><pre>{{ guide.command }}</pre><button type="button" @click="copyCommand(guide.command)">{{ copied === 'done' ? '已复制' : copied === 'failed' ? '复制失败，请手动选中命令' : '复制命令' }}</button></div>
          <p v-if="guide.url"><a :href="guide.url" target="_blank" rel="noreferrer">打开官方安装说明</a></p>
          <p class="small muted">{{ guide.after }}</p>
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
            <p v-if="!canList" class="small muted">DeepSeek 的模型由 pi 内置的目录提供，直接从下面选择即可。</p>
            <div v-else class="card-actions left"><button type="button" :disabled="busy || listing || (!key.trim() && !savedKeyFits) || !model.baseURL" @click="fetchModels">{{ listing ? '正在获取模型…' : '获取模型列表' }}</button></div>
            <p v-if="list?.error" class="error small" role="alert">{{ list.error }}</p>
            <p v-else-if="list" class="small muted">这个 Key 可以用 {{ list.models.length }} 个模型{{ list.models.length ? '，点下面的输入框搜索或选择' : '' }}。</p>
            <p v-else-if="canList && !vendor?.models.length && !model.model" class="small muted">填好 API Key 后会自动取到模型列表；取不到时，可以手动填写模型 ID。</p>
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
