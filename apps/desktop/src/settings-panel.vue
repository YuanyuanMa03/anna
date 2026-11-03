<script setup lang="ts">
import type { Command, ModelSettings, RuntimeSnapshot } from '../../../packages/shared/contracts'
import { computed, reactive, ref } from 'vue'
import { brainChoices } from '../../../packages/agents/brains'
import { catalog } from '../../../packages/agents/catalog'
import { installationGuide } from '../../../packages/agents/installation'
import { companion } from '../../../packages/character/manifest'
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

function save() { emit('command', { type: 'configure', model: { ...model }, key: key.value }); key.value = '' }
function selectProvider() {
  if (model.provider === 'deepseek-official') { model.baseURL = 'https://api.deepseek.com'; model.model = 'deepseek-flash'; model.api = 'openai-completions' }
}
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
          <p class="small muted">还没有模型密钥？可以从 <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer">DeepSeek 开放平台</a>注册账号，在 API Keys 中创建密钥，并查看账户余额。把密钥填到下面；它不同于聊天网站的登录密码。</p>
          <p class="muted">模型提供商负责提供推理服务，模型 ID 是具体型号，API Key 是访问凭据。密钥加密保存在本机；发送任务时会把任务内容交给你选择的模型。</p>
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
