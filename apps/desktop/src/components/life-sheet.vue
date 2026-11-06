<script setup lang="ts">
import type { Command, PersonalityProfile, RuntimeSnapshot } from '../../../../packages/shared/contracts'
import { computed, reactive, ref, watch } from 'vue'
import { usageKind } from '../../../../packages/agents/usage'
import { defaultProfile, personalityCards } from '../../../../packages/character/personality'
import SettingsPanel from '../settings-panel.vue'
import MemoryPanel from './memory-panel.vue'

const props = defineProps<{ snapshot: RuntimeSnapshot, busy: boolean, error?: string }>()
const emit = defineEmits<{ command: [command: Command], close: [] }>()
const onboarding = computed(() => !props.snapshot.settings.onboardingComplete)
const historyAgent = ref<'claude' | 'codex'>(props.snapshot.settings.kernel === 'codex' ? 'codex' : 'claude')
const allHistory = ref(false)
const useCurrentDirectory = ref(false)
const step = ref(props.snapshot.settings.firstTaskPending ? 'first-task' : props.snapshot.settings.connectionVerified && onboarding.value ? 'personality' : props.snapshot.settings.workspace && props.snapshot.workspace.known ? 'brain' : 'workspace')
watch(() => props.snapshot.settings.firstTaskPending, (pending) => {
  if (pending)
    step.value = 'first-task'
})
const profile = reactive<PersonalityProfile>({ ...(props.snapshot.settings.personality ?? defaultProfile()) })
const ready = computed(() => Boolean(props.snapshot.settings.connectionVerified) && props.snapshot.state === 'ready' && props.snapshot.credential !== 'rejected')
const agent = computed(() => props.snapshot.settings.kernel === 'claude-code' ? 'claude' : props.snapshot.settings.kernel.replace('acp:', ''))
const provider = computed(() => props.snapshot.agents.providers[agent.value]?.provider)
const quota = computed(() => agent.value === 'pi' ? props.snapshot.agents.usage['pi:current'] : provider.value ? props.snapshot.agents.usage[`${agent.value}:${provider.value}`] : props.snapshot.agents.usage[`${agent.value}:current`])
const providerInfo = computed(() => props.snapshot.agents.mine[agent.value]?.find(item => item.name === provider.value))
function draw() {
  profile.type = personalityCards[Math.floor(Math.random() * personalityCards.length)]!.id
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="!onboarding && emit('close')">
    <section class="sheet life-sheet" role="dialog" aria-modal="true" aria-label="Anna 档案">
      <div class="sheet-heading"><div><span class="eyebrow">HELLO, ANNA</span><h2>{{ snapshot.settings.firstTaskPending ? '第一次一起做事' : onboarding ? 'Anna 正在醒来' : 'Anna 档案' }}</h2><p class="small muted">{{ onboarding ? '一步一步来，让我认识你，也准备好陪你做事。' : '你们一起的时光、她的大脑、相处方式和当前能力。' }}</p></div><button v-if="!onboarding && !snapshot.settings.firstTaskPending" class="icon-button" aria-label="关闭设置" @click="emit('close')">×</button></div>
      <nav class="sheet-tabs" aria-label="配置步骤">
        <button :aria-pressed="step === 'workspace'" @click="step = 'workspace'">1 工作目录</button>
        <button :disabled="onboarding && (!snapshot.settings.workspace || !snapshot.workspace.known)" :aria-pressed="step === 'brain'" @click="step = 'brain'">2 选择大脑</button>
        <button :disabled="onboarding && (!snapshot.settings.workspace || !snapshot.workspace.known)" :aria-pressed="step === 'connection'" @click="step = 'connection'">3 接通模型</button>
        <button :disabled="onboarding && !ready" :aria-pressed="step === 'personality'" @click="step = 'personality'">4 认识彼此</button>
        <button v-if="snapshot.settings.firstTaskPending" :aria-pressed="step === 'first-task'" @click="step = 'first-task'">5 第一次一起做事</button><button v-if="!onboarding" :aria-pressed="step === 'memory'" @click="step = 'memory'">我们</button><button v-if="!onboarding" :aria-pressed="step === 'history'" @click="step = 'history'">其他会话</button><button v-if="!onboarding" :aria-pressed="step === 'records'" @click="step = 'records'">工作记录</button><button v-if="!onboarding" :aria-pressed="step === 'status'" @click="step = 'status'">生命状态</button>
      </nav>
      <template v-if="step === 'workspace'">
        <h3>先为我们选一个工作目录</h3>
        <p>工作目录就是 Anna 可以帮你查看和整理文件的地方。建议先创建一个空文件夹来体验。</p>
        <p class="small muted">{{ snapshot.platform.os === 'win32' ? 'Windows 将打开文件夹选择窗口，可以选择例如“文档”中的项目文件夹。' : '点击下方按钮，在系统窗口里选择一个文件夹。' }}</p>
        <button class="primary" :disabled="busy" @click="emit('command', { type: 'choose-workspace' })">选择工作目录…</button>
        <p v-if="snapshot.settings.workspace" class="workspace-path">{{ snapshot.workspace.path }}</p>
        <div v-if="snapshot.settings.workspace && !snapshot.workspace.known" class="card"><p>你信任这个文件夹吗？信任后，Anna 可以按权限模式修改其中的文件；先看看则只读。</p><button :disabled="busy" @click="emit('command', { type: 'trust', trusted: false })">先只读看看</button><button :disabled="busy" @click="emit('command', { type: 'trust', trusted: true })">信任这个文件夹</button></div>
        <button :disabled="busy || !snapshot.settings.workspace || !snapshot.workspace.known" @click="step = 'brain'">下一步：选择大脑</button>
      </template>
      <template v-else-if="step === 'brain'">
        <SettingsPanel inline section="brain" :snapshot="snapshot" :busy="busy" @command="emit('command', $event)" />
        <button class="primary" :disabled="busy" @click="step = 'connection'">确认大脑，接通模型</button>
      </template>
      <template v-else-if="step === 'connection'">
        <SettingsPanel inline section="connection" :snapshot="snapshot" :busy="busy" @command="emit('command', $event)" />
        <button class="primary" :disabled="busy || !ready" @click="step = 'personality'">下一步：认识彼此</button>
        <p v-if="!ready" class="small muted">先配置模型或选择已安装的大脑，连接就绪后继续。密钥可用性需要真实对话验证。</p>
      </template>
      <template v-else-if="step === 'first-task'">
        <h3>我们先做一件小事</h3><p>从你选择的工作目录开始，也可以先聊聊。只有点击任务后才会调用模型。</p>
        <button v-for="task in snapshot.starterTasks" :key="task" :disabled="busy" @click="emit('command', { type: 'first-task', text: task })">{{ task }}</button>
        <button :disabled="busy" @click="emit('command', { type: 'first-task' })">先和 Anna 聊聊</button>
      </template>
      <form v-else-if="step === 'personality'" @submit.prevent="emit('command', { type: 'personality', profile: { ...profile }, complete: onboarding })">
        <h3>你希望怎样和 Anna 相处？</h3>
        <p class="small muted">这些问题只用于调整交流方式，保存在本机，随时可修改。无需真实姓名、年龄、地址或其他私密信息；交流时会将必要偏好发送给所选模型。人格卡借鉴 16 型风格，不是心理测评。</p>
        <label>怎么称呼你（选填）<input v-model="profile.nickname" maxlength="40" placeholder="昵称即可"></label>
        <label>希望一起做什么<select v-model="profile.purpose"><option value="work">工作与创作</option><option value="study">学习与探索</option><option value="company">聊天与日常陪伴</option></select></label>
        <label>喜欢怎样的回答<select v-model="profile.detail"><option value="brief">简短直接</option><option value="balanced">长短适中</option><option value="detailed">详细解释</option></select></label>
        <label>建议方式<select v-model="profile.advice"><option value="gentle">温和有主见</option><option value="direct">坦率直接</option></select></label><div class="sheet-heading"><h3>选择她的人格卡</h3><button type="button" @click="draw">抽一张试试</button></div>
        <div class="brain-cards" role="radiogroup" aria-label="人格卡"><button v-for="card in personalityCards" :key="card.id" type="button" role="radio" :aria-checked="profile.type === card.id" class="personality-card" @click="profile.type = card.id"><span class="brain-symbol">{{ card.code }}</span><strong>{{ card.label }}</strong><small>{{ card.description }}</small></button></div>
        <div class="card"><strong>对话预览</strong><p>{{ personalityCards.find(card => card.id === profile.type)?.work }}</p><p>{{ personalityCards.find(card => card.id === profile.type)?.company }}</p></div><p class="small muted">所有人格都保留诚实、尊重与权限边界。你以后可以和她一起调整。</p>
        <button class="primary" :disabled="busy || (onboarding && !ready)" type="submit">{{ onboarding ? '准备好了，唤醒 Anna' : '保存相处偏好' }}</button>
      </form>
      <MemoryPanel v-else-if="step === 'memory'" :snapshot="snapshot" :busy="busy" @command="emit('command', $event)" />
      <template v-else-if="step === 'history'">
        <h3>从已有的工作继续</h3><p class="small muted">仅在你打开列表后读取本机历史。选择后创建 Anna 分支，原会话不会追加；继续对话时，所选历史将用于当前大脑的模型请求。</p>
        <label>来自哪个大脑<select v-model="historyAgent"><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label>
        <label class="check-row"><input v-model="allHistory" type="checkbox">查看其他工作目录</label>
        <button :disabled="busy" @click="emit('command', { type: 'history-list', agent: historyAgent, all: allHistory })">读取历史列表</button>
        <template v-if="snapshot.externalHistory?.agent === historyAgent">
          <p v-if="!snapshot.externalHistory.items.length">没有找到会话。</p>
          <article v-for="session in snapshot.externalHistory.items" :key="session.id" class="card"><strong>{{ session.title }}</strong><p class="small workspace-path">{{ session.workspace ?? '未记录目录' }} · {{ new Date(session.updatedAt).toLocaleString('zh-CN') }}</p><button :disabled="busy" @click="emit('command', { type: 'history-preview', agent: historyAgent, id: session.id }); useCurrentDirectory = false">预览会话</button></article>
          <button v-if="snapshot.externalHistory.nextCursor" :disabled="busy" @click="emit('command', { type: 'history-list', agent: historyAgent, all: allHistory, cursor: snapshot.externalHistory.nextCursor })">下一页会话</button>
          <article v-if="snapshot.externalHistory.preview" class="card">
            <h3>{{ snapshot.externalHistory.preview.session.title }}</h3><p v-for="(message, index) in snapshot.externalHistory.preview.messages" :key="index" class="history-preview"><strong>{{ message.role === 'user' ? '用户' : historyAgent }}</strong>：{{ message.text }}</p><button v-if="snapshot.externalHistory.preview.nextCursor" :disabled="busy" @click="emit('command', { type: 'history-preview', agent: historyAgent, id: snapshot.externalHistory.preview.session.id, cursor: snapshot.externalHistory.preview.nextCursor })">下一页对话</button><p class="small muted">这里展示所选片段；新分支继承原会话的完整历史。</p>
            <button v-if="snapshot.externalHistory.preview.session.workspace && snapshot.externalHistory.preview.session.workspace !== snapshot.workspace.path" :disabled="busy" @click="emit('command', { type: 'choose-workspace' })">选择历史工作目录…</button>
            <button v-if="!snapshot.workspace.known" :disabled="busy" @click="emit('command', { type: 'trust', trusted: false })">只读使用这个目录</button>
            <label v-if="snapshot.externalHistory.preview.session.workspace !== snapshot.workspace.path" class="check-row"><input v-model="useCurrentDirectory" type="checkbox">原目录已迁移或不可用：使用当前已确认的工作目录继续</label>
            <button :disabled="busy || !snapshot.workspace.known" @click="emit('command', { type: 'history-fork', agent: historyAgent, id: snapshot.externalHistory.preview.session.id, useCurrentDirectory })">确认创建 Anna 分支</button>
          </article>
        </template>
      </template>
      <template v-else-if="step === 'records'">
        <h3>我们一起做过的事</h3><p v-if="!snapshot.workRecords?.length" class="muted">还没有这个工作目录的记录。</p>
        <article v-for="record in [...(snapshot.workRecords ?? [])].reverse()" :key="record.taskId" class="card"><strong>{{ record.request }}</strong><p class="small muted">{{ record.at }} · {{ record.undone ? '已撤销' : record.status === 'completed' ? '已完成' : record.status === 'aborted' ? '已中断' : '未完成' }} · {{ record.by?.join('、') || 'Anna' }}</p><p>{{ record.result?.summary }}</p><p v-if="record.result?.usage" class="small">输入 {{ record.result.usage.input ?? '未知' }} · 输出 {{ record.result.usage.output ?? '未知' }} token{{ record.result.usage.partial ? '（部分统计）' : '' }}</p></article>
      </template>
      <template v-else>
        <h3>Anna 此刻的状态</h3>
        <div class="vital-grid"><article><small>大脑</small><strong>{{ snapshot.kernel.label }}</strong></article><article><small>连接</small><strong>{{ ready ? '已验证可用' : ({ ready: '待验证', starting: '正在连接', stopped: '未连接', unconfigured: '待配置', running: '正在工作', error: '连接异常' })[snapshot.state] }}</strong></article><article><small>模型</small><strong>{{ snapshot.actualModel ?? snapshot.model?.id ?? (snapshot.settings.kernel === 'pi' ? snapshot.settings.model.model : providerInfo?.model ?? '由 agent 管理') }}</strong></article><article><small>共同记忆</small><strong>{{ snapshot.memories.length }} 条</strong></article></div>
        <h3>能力来源</h3><button :disabled="busy" @click="emit('command', { type: 'capabilities-refresh' })">刷新能力报告</button>
        <template v-if="snapshot.capabilities"><p class="small muted">{{ snapshot.capabilities.source }} · {{ new Date(snapshot.capabilities.at).toLocaleString('zh-CN') }}</p><p v-if="snapshot.capabilities.unknown.length" class="small muted">尚未报告：{{ snapshot.capabilities.unknown.map(kind => ({ skills: '技能', plugins: '插件', mcp: 'MCP 服务' })[kind] ?? kind).join('、') }}</p><article v-for="(entry, index) in snapshot.capabilities.entries" :key="index" class="card"><strong>{{ entry.name }}</strong><p class="small">{{ ({ skill: '技能', mcp: 'MCP 服务', plugin: '插件', tool: '工具' })[entry.kind] }} · {{ entry.state === 'available' ? '大脑报告可用' : entry.state === 'configured' ? '已发现、未验证' : '加载失败' }}</p><p class="small workspace-path">{{ entry.source }}</p></article></template>
        <h3>当前能力</h3><p>{{ snapshot.tools.length }} 个已报告工具 · {{ snapshot.plugins.length }} 个已报告组件</p><div class="capability-tags"><code v-for="tool in snapshot.tools" :key="tool">{{ tool }}</code><code v-for="plugin in snapshot.plugins" :key="plugin">{{ plugin }}</code></div>
        <p class="small muted">外部 agent 使用自身配置加载能力；尚未报告的 Skills / 插件数量显示为未知。Anna 不会把工具数量当作 Skills 数量。</p>
        <p>Skills：{{ snapshot.skills ? `${snapshot.skills.length} 个已加载` : '由外部 agent 管理，数量未知' }}</p>
        <div class="capability-tags"><code v-for="skill in snapshot.skills" :key="skill">{{ skill }}</code></div>
        <p class="small workspace-path">本机配置：{{ snapshot.agents.detected.find(item => item.id === agent)?.configDir ?? 'Anna 内置配置' }}</p>
        <h3>模型额度</h3><p v-if="!quota">{{ providerInfo?.usage ? '可查询，点击下方刷新。' : '当前服务商未提供可读取的额度，未知。' }}</p>
        <p v-if="quota?.error" class="error">{{ quota.error }}</p>
        <p v-if="quota" class="small muted">查询于 {{ quota.at }}{{ quota.stale ? ' · 已过期，保留上次结果' : '' }} · {{ quota.plan }}</p>
        <div v-for="balance in quota?.balances" :key="balance.label"><p>{{ balance.label }}：剩余 {{ balance.remaining }} {{ balance.unit }}</p><progress v-if="balance.total && balance.total > 0" :value="balance.remaining" :max="balance.total" /></div>
        <div v-for="(window, index) in quota?.windows" :key="`${window.window}:${index}`"><p>{{ window.label ?? (window.window === 'weekly' ? '本周' : '五小时') }}已用 {{ window.usedPercent }}%</p><progress :value="window.usedPercent" max="100" /></div>
        <button v-if="provider && providerInfo?.usage && ['claude', 'codex', 'gemini'].includes(agent)" :disabled="busy" @click="emit('command', { type: 'provider-usage', app: agent as 'claude' | 'codex' | 'gemini', name: provider })">刷新额度</button>
        <button v-if="agent === 'codex' && !provider" :disabled="busy" @click="emit('command', { type: 'native-usage' })">刷新账号额度</button>
        <button v-if="agent === 'pi' && usageKind(snapshot.settings.model.baseURL)" :disabled="busy || !snapshot.hasKey" @click="emit('command', { type: 'pi-usage' })">刷新 pi 额度</button>
        <template v-if="snapshot.result"><h3>最近任务</h3><p>{{ snapshot.result.summary }}</p><p>{{ ((snapshot.result.elapsedMs ?? 0) / 1000).toFixed(1) }} 秒 · {{ snapshot.result.toolCalls ?? 0 }} 次工具调用</p><p v-if="snapshot.result.usage">Token{{ snapshot.result.usage.partial ? '（部分统计）' : '' }}：输入 {{ snapshot.result.usage.input ?? '未知' }} · 输出 {{ snapshot.result.usage.output ?? '未知' }} · 缓存读取 {{ snapshot.result.usage.cacheRead ?? '未知' }} · 缓存写入 {{ snapshot.result.usage.cacheWrite ?? '未知' }}</p><p v-else>Token：大脑尚未报告</p></template>
        <h3>会话</h3><p class="small workspace-path">{{ snapshot.sessionId ?? '还没有会话' }} · {{ snapshot.restored ? '已续接 Anna 的上次会话' : '当前新会话' }}</p><p class="small muted">每个大脑保留 Anna 中的会话，切回时续接，共同记忆保留。其他应用中的会话可从“其他会话”选择并创建 Anna 分支。</p>
      </template>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>
  </div>
</template>
