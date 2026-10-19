<script setup lang="ts">
import type { MotionCue } from '../../../packages/character/manifest'
import type { AnnaPhase, AnnaState, ApprovalScope, Command, FileChange, Message, PermissionMode, RuntimeSnapshot, ToolActivity, WeixinState } from '../../../packages/shared/contracts'
import type { Anchors } from './character-stage.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { companion } from '../../../packages/character/manifest'
import { renderMarkdown } from '../../../packages/character/markdown'
import { modes } from '../../../packages/permissions/modes'
import CharacterStage from './character-stage.vue'
import AgentsSheet from './components/agents-sheet.vue'
import ApprovalCard from './components/approval-card.vue'
import CapabilitiesSheet from './components/capabilities-sheet.vue'
import ModeSwitch from './components/mode-switch.vue'
import ResultCard from './components/result-card.vue'
import { tour, tourPrompts } from './online'
import SettingsPanel from './settings-panel.vue'

const phaseLabels: Record<AnnaPhase, string> = { offline: '休息中', idle: '在这儿', thinking: '思考中', responding: '正在回答', inspecting: '查看资料', editing: '修改文件', running: '运行命令', testing: '验证中', waiting: '等你确认', compacting: '整理上下文', retrying: '重试中', supervising: '督工中', reviewing: '审阅中', done: '完成了', failed: '遇到问题' }
const toolLabels: Record<string, string> = { read: '读取', ls: '列目录', find: '查找', grep: '搜索', edit: '修改', write: '写入', bash: '终端', powershell: '终端', anna_status: '状态', anna_memory: '记忆', anna_delegate: '派活' }

const snapshot = ref<RuntimeSnapshot>()
const messages = ref<Message[]>([])
const settingsOpen = ref(false)
const pluginsOpen = ref(false)
const agentsOpen = ref(false)
const collaborator = ref<{ agent: string, label: string, provider?: string, state: 'running' | 'done' | 'failed', line: string, step: number }>()
const update = ref<{ state: string, version?: string, notes?: string, message?: string, manual?: boolean }>()
const weixinOpen = ref(false)
const drawer = ref<'history' | 'work' | 'changes' | undefined>()
const changes = ref<FileChange[]>([])
const weixin = ref<WeixinState>({ phase: 'offline', message: '微信尚未连接' })
const verifyCode = ref('')
const busy = ref(false)
const error = ref('')
const notice = ref('')
const input = ref('')
const stream = ref('')
const tools = ref<ToolActivity[]>([])
const anna = ref<AnnaState>({ phase: 'offline', line: '', step: 0 })
const modeLine = ref<{ text: string, at: number }>()
const autoSpeak = ref(false)
const speaking = ref(false)
const streamingAt = ref(0)
const now = ref(Date.now())
const history = ref<HTMLDivElement>()
const bubble = ref<HTMLDivElement>()
const modeSwitch = ref<InstanceType<typeof ModeSwitch>>()
const wide = ref(window.innerWidth > 1100)
function resize() { wide.value = window.innerWidth > 1100 }
let release: (() => void) | undefined
let clock: number | undefined

const character = computed(() => companion(snapshot.value?.settings.characterId))
const suggestions = computed(() => import.meta.env.VITE_ANNA_WEB ? tourPrompts() : ['看看这个工作文件夹里有什么，给我一个概览', '帮我找出项目里的 TODO 并整理成清单', `${character.value.name}，你好，介绍一下你自己。`])
const running = computed(() => snapshot.value?.state === 'running')
const configuring = computed(() => busy.value || snapshot.value?.state === 'starting')
const mode = computed<PermissionMode>(() => snapshot.value?.mode ?? 'ask')
/** pi needs a model key; an external brain uses its own login. */
const canChat = computed(() => Boolean(snapshot.value && (snapshot.value.hasKey || snapshot.value.settings.kernel !== 'pi')))
const needsTrust = computed(() => Boolean(snapshot.value && snapshot.value.settings.workspace && !snapshot.value.workspace.known))
const connected = computed(() => snapshot.value?.state === 'ready' || snapshot.value?.state === 'running')
/** Honest connection label: a saved key is only "connected" once a real reply came back. */
const connection = computed(() => {
  const state = snapshot.value?.state
  if (connected.value)
    return snapshot.value?.credential === 'rejected' ? '密钥被拒绝' : snapshot.value?.credential === 'unverified' ? '已就绪 · 未验证' : '已连接'
  return state === 'starting' ? '正在连接' : state === 'error' ? '连接出错' : '未连接'
})
/** After a companion switch, earlier replies belong to someone else: the newcomer greets instead of repeating them. */
const repliesFrom = ref(0)
const lastReply = computed(() => messages.value.slice(repliesFrom.value).reverse().find(message => message.role === 'assistant' && !message.note)?.text ?? '')
const subtitle = computed(() => {
  if (running.value)
    return stream.value
  if (modeLine.value && now.value - modeLine.value.at < 4500)
    return modeLine.value.text
  if (snapshot.value?.error)
    return snapshot.value.credential === 'rejected' ? '我连不上模型：密钥被服务商拒绝了。到“模型与设置”里换一个吧。' : '这一轮没有成功，原因写在下面。'
  return lastReply.value || (canChat.value ? character.value.greeting : '先给我接上一个模型，我们就能开始了。')
})
/** Mouth moves while text streams in, while reading aloud, or while greeting a mode change. */
const mouth = computed(() => speaking.value || (anna.value.phase === 'responding' && now.value - streamingAt.value < 400) || Boolean(modeLine.value && now.value - modeLine.value.at < 1600))
const callTools = computed(() => tools.value.filter(tool => tool.phase === 'call'))
const resultFor = (callId: string) => tools.value.find(tool => tool.phase === 'result' && tool.callId === callId)
const workspaceName = computed(() => snapshot.value?.workspace.path.split(/[\\/]/).filter(Boolean).at(-1) ?? '工作区')

function summarize(tool: ToolActivity) {
  try {
    const args = JSON.parse(tool.text) as Record<string, unknown>
    return String(args.path ?? args.command ?? args.pattern ?? args.task ?? args.text ?? '').split('\n')[0]!.slice(0, 80)
  }
  catch { return tool.text.slice(0, 80) }
}

function accept(next: RuntimeSnapshot) {
  if (next.messages)
    messages.value = next.messages
  snapshot.value = next
}

async function scrollHistory() { await nextTick(); history.value?.scrollTo({ top: history.value.scrollHeight }) }
function speak(text: string) {
  speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 600))
  utterance.lang = 'zh-CN'
  utterance.pitch = character.value.voice.pitch
  utterance.rate = character.value.voice.rate
  utterance.onstart = () => { speaking.value = true }
  utterance.onend = utterance.onerror = () => { speaking.value = false }
  speechSynthesis.speak(utterance)
}

// ── Stage interaction: words come from her mouth, cards from her hand ─────────
const anchors = ref<Anchors>({})
const cue = ref<{ kind: MotionCue, at: number }>()
const tail = ref('')
const tethers = ref<{ d: string, kind: 'approval' | 'review' }[]>([])
const propsColumn = ref<HTMLElement>()
function play(kind: MotionCue) { cue.value = { kind, at: Date.now() } }

/** A tapered speech tail from the bubble's nearest edge to her mouth. */
function tailPath(box: DOMRect, mouth: { x: number, y: number }) {
  const left = mouth.x < box.left
  const edgeX = left ? box.left + 8 : box.right - 8
  const edgeY = Math.min(Math.max(mouth.y, box.top + 26), box.bottom - 26)
  const tipX = mouth.x + (left ? 26 : -26)
  const midX = (edgeX + tipX) / 2
  return `M ${edgeX} ${edgeY - 11} Q ${midX} ${edgeY - 4} ${tipX} ${mouth.y} Q ${midX} ${edgeY + 8} ${edgeX} ${edgeY + 11} Z`
}
/** A soft curve from her hand to the card she is holding out or reading. */
function handPath(box: DOMRect, hand: { x: number, y: number }) {
  const x = box.left + 2
  const y = Math.min(Math.max(hand.y, box.top + 18), box.bottom - 18)
  return `M ${hand.x} ${hand.y} C ${hand.x + (x - hand.x) * 0.45} ${hand.y}, ${x - (x - hand.x) * 0.35} ${y}, ${x} ${y}`
}
function onAnchors(next: Anchors) {
  anchors.value = next
  const box = bubble.value?.getBoundingClientRect()
  tail.value = next.mouth && box && subtitle.value ? tailPath(box, next.mouth) : ''
  const lines: { d: string, kind: 'approval' | 'review' }[] = []
  const held = propsColumn.value?.querySelector('.approval-request') ?? (anna.value.phase === 'reviewing' ? propsColumn.value?.querySelector('.collaborator-card') : null)
  if (next.hand && held)
    lines.push({ d: handPath(held.getBoundingClientRect(), next.hand), kind: held.classList.contains('approval-request') ? 'approval' : 'review' })
  tethers.value = lines
}
/** Cards appear out of her hand and settle into place. */
function fromHand(element: Element, done: () => void) {
  const hand = anchors.value.hand
  const box = element.getBoundingClientRect()
  if (!hand || matchMedia('(prefers-reduced-motion: reduce)').matches)
    return done()
  const dx = hand.x - (box.left + box.width / 2)
  const dy = hand.y - (box.top + box.height / 2)
  element.animate([{ transform: `translate(${dx}px, ${dy}px) scale(0.12)`, opacity: 0 }, { transform: `translate(${dx * 0.15}px, ${dy * 0.15}px) scale(1.03)`, opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }], { duration: 560, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = done
}
/** A new reply grows out of her mouth. */
function fromMouth() {
  const mouth = anchors.value.mouth
  const element = bubble.value?.parentElement
  if (!mouth || !element || matchMedia('(prefers-reduced-motion: reduce)').matches)
    return
  const box = element.getBoundingClientRect()
  element.animate([{ transformOrigin: `${mouth.x - box.left}px ${mouth.y - box.top}px`, transform: 'scale(0.08)', opacity: 0 }, { transformOrigin: `${mouth.x - box.left}px ${mouth.y - box.top}px`, transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2,.9,.25,1.15)' })
}

async function run(command: Command) {
  const ownsBusy = !['character', 'approval', 'send', 'stop', 'mode', 'changes', 'rule-remove', 'memory-forget', 'weixin-status', 'weixin-login', 'weixin-code', 'weixin-disconnect'].includes(command.type)
  if (ownsBusy)
    busy.value = true
  error.value = ''
  try {
    const result = await window.anna.invoke(command)
    if (!result.ok) { error.value = result.error; return false }
    accept(result.snapshot)
    return true
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); return false }
  finally {
    if (ownsBusy)
      busy.value = false
  }
}

function send(text = input.value) {
  const body = text.trim()
  if (!body || configuring.value || !canChat.value || needsTrust.value)
    return
  input.value = ''
  if (!running.value) {
    tools.value = []
    stream.value = ''
    collaborator.value = undefined
  }
  void run({ type: 'send', text: body })
}
const decide = (id: string, allow: boolean, scope: ApprovalScope) => run({ type: 'approval', id, allow, scope })
async function showChanges() {
  if (snapshot.value?.result && await run({ type: 'changes', taskId: snapshot.value.result.taskId }))
    drawer.value = 'changes'
}
const undo = (force: boolean) => snapshot.value?.result && run({ type: 'undo', taskId: snapshot.value.result.taskId, force })
function keydown(event: KeyboardEvent) {
  if (event.key === 'Tab' && event.shiftKey && canChat.value) {
    event.preventDefault()
    modeSwitch.value?.cycle()
  }
}

onMounted(async () => {
  window.addEventListener('resize', resize)
  window.addEventListener('keydown', keydown)
  clock = window.setInterval(() => { now.value = Date.now() }, 200)
  release = window.anna.subscribe((event) => {
    switch (event.type) {
      case 'weixin': weixin.value = event.state; break
      case 'navigate':
        if (event.panel === 'providers')
          agentsOpen.value = true
        else settingsOpen.value = true
        break
      case 'snapshot': accept(event.snapshot); break
      case 'tool': tools.value.push(event); break
      case 'anna': anna.value = event.state; break
      case 'stream': stream.value = event.text; streamingAt.value = Date.now(); break
      case 'result': if (autoSpeak.value)
        speak(lastReply.value); break
      case 'mode': modeLine.value = { text: event.line, at: Date.now() }; break
      case 'changes': changes.value = event.changes; break
      case 'collaborator': collaborator.value = event; break
      case 'update': update.value = event; break
      case 'core':
        notice.value = event.status === 'ready' ? '' : event.message ?? ''
        if (event.status === 'ready')
          void run({ type: 'snapshot' }).then(() => canChat.value && run({ type: 'connect' }))
        break
    }
  })
  await run({ type: 'snapshot' })
  if (snapshot.value)
    anna.value = snapshot.value.anna
  if (!import.meta.env.VITE_ANNA_WEB)
    await run({ type: 'weixin-status' })
  if (canChat.value)
    await run({ type: 'connect' })
  else
    settingsOpen.value = true
})
watch(() => messages.value.length, () => { void scrollHistory() })
watch(() => anna.value.phase, (phase, previous) => {
  if (phase === 'responding' && previous !== 'responding')
    fromMouth()
  if (phase === 'reviewing' && previous !== 'reviewing')
    play('review')
})
watch(() => snapshot.value?.approvals.length ?? 0, (count, previous) => {
  if (count > (previous ?? 0))
    play('present')
})
watch(() => snapshot.value?.result?.taskId, () => {
  const result = snapshot.value?.result
  if (result?.ok && result.status === 'completed' && result.changes.length)
    play('celebrate')
})
watch(() => character.value.id, (_, previous) => {
  if (previous)
    repliesFrom.value = messages.value.length
  window.setTimeout(() => play('greet'), 1200)
})
watch(subtitle, async () => { await nextTick(); bubble.value?.scrollTo({ top: running.value ? bubble.value.scrollHeight : 0 }) })
onBeforeUnmount(() => { window.removeEventListener('resize', resize); window.removeEventListener('keydown', keydown); release?.(); window.clearInterval(clock); speechSynthesis.cancel() })
const web = Boolean(import.meta.env.VITE_ANNA_WEB)
// Online demo: say so up front when the free model quota has run out, rather than letting a message fail.
const quotaOut = ref(false)
async function checkQuota() {
  try {
    quotaOut.value = Boolean((await (await fetch('./api/quota')).json()).out)
  }
  catch {}
}
if (web) {
  void checkQuota()
  const quotaTimer = window.setInterval(() => { void checkQuota() }, 60000)
  onBeforeUnmount(() => window.clearInterval(quotaTimer))
  watch(() => error.value || snapshot.value?.error, () => { void checkQuota() })
}
</script>

<template>
  <main v-if="snapshot" class="app-shell" :data-phase="anna.phase" :data-mode="mode">
    <header class="topbar">
      <div class="brand">anna<span>v0.5</span></div>
      <span class="connection" :title="snapshot.model ? `${snapshot.kernel.label} · ${snapshot.model.id} · 思考 ${snapshot.model.thinking}` : snapshot.settings.model.model"><i :class="{ online: connected && snapshot.credential !== 'unverified' && snapshot.credential !== 'rejected', bad: snapshot.credential === 'rejected' || snapshot.state === 'error' }" />{{ connection }} · {{ snapshot.model?.id ?? snapshot.settings.model.model }}</span>
      <nav class="header-actions">
        <button :aria-pressed="drawer === 'history'" @click="drawer = drawer === 'history' ? undefined : 'history'">对话记录</button>
        <button :aria-pressed="drawer === 'work'" @click="drawer = drawer === 'work' ? undefined : 'work'">工作过程<small v-if="callTools.length">{{ callTools.length }}</small></button>
        <button v-if="!web" @click="weixinOpen = true; run({ type: weixin.phase === 'offline' ? 'weixin-login' : 'weixin-status' })"><i class="dot" :class="{ online: weixin.phase === 'connected' }" />微信</button>
        <button @click="agentsOpen = true; run({ type: 'snapshot' })">外部 agent<small v-if="snapshot.agents.detected.filter(agent => agent.installed && agent.tier === 'delegate').length">{{ snapshot.agents.detected.filter(agent => agent.installed && agent.tier === 'delegate').length }}</small></button>
        <button @click="pluginsOpen = true">外观与能力</button>
        <button @click="settingsOpen = true">模型与设置</button>
      </nav>
    </header>

    <section class="scene" :aria-label="`${character.name} 的舞台`">
      <div class="stage">
        <div class="stage-halo" />
        <CharacterStage :character="character" :phase="anna.phase" :mode="mode" :speaking="mouth" :zoom="1.7" :align="wide ? 0.62 : 0.4" :cue="cue" :reach="wide ? 260 : 0" @poke="drawer = 'work'" @anchors="onAnchors" />
        <div class="status-ribbon" role="status" :data-phase="anna.phase" :style="{ left: `${(wide ? 0.62 : 0.4) * 100}%` }"><em class="mode-badge" :data-mode="mode">{{ modes[mode].label }}</em><i />{{ phaseLabels[anna.phase] }}<span v-if="anna.line">· {{ anna.line }}</span><b v-if="running && anna.step">第 {{ anna.step }} 步</b></div>
      </div>

      <div class="speech" :class="{ live: running }">
        <span class="speaker">{{ character.name }}<small> · {{ character.tagline }}</small></span>
        <div ref="bubble" class="bubble" aria-live="polite"><div v-if="subtitle" class="rich" v-html="renderMarkdown(subtitle)" /><p v-else class="typing"><i /><i /><i /></p></div>
        <div v-if="!messages.length && canChat && !running && !needsTrust" class="suggestions"><button v-for="item in suggestions" :key="item" @click="send(item)">{{ item }}</button></div>
      </div>

      <aside ref="propsColumn" class="props" :aria-label="`${character.name} 手上的事`">
        <div v-if="web && !messages.length && !running" class="card tour-card">
          <span class="eyebrow">Anna 不只是会聊天</span>
          <dl><template v-for="item in tour.online" :key="item.title"><dt>{{ item.title }}</dt><dd>{{ item.body }}</dd></template></dl>
          <span class="eyebrow">桌面版还能做</span>
          <dl class="desktop-only"><template v-for="item in tour.desktop" :key="item.title"><dt>{{ item.title }}</dt><dd>{{ item.body }}</dd></template></dl>
          <a class="link" href="https://anna.mayuanyuan.top/#download" target="_blank" rel="noopener">下载桌面版 ↗</a>
        </div>

        <div v-if="needsTrust" class="card trust-card" role="alert">
          <span class="eyebrow">新的工作文件夹</span>
          <strong>你信任这个文件夹里的内容吗？</strong>
          <pre>{{ snapshot.workspace.path }}</pre>
          <p class="small">信任后，{{ character.name }} 会读取其中的 AGENTS.md 等项目说明，并可以使用“协作”和“放手”模式。“先只读看看”会进入规划模式，之后可以随时切换。来源不明的仓库可能包含诱导 AI 的指令，建议只信任你自己的项目。</p>
          <div class="card-actions">
            <button :disabled="configuring" @click="run({ type: 'trust', trusted: false })">先只读看看</button>
            <button class="primary" :disabled="configuring" @click="run({ type: 'trust', trusted: true })">信任并开始</button>
          </div>
        </div>

        <Transition :css="false" @enter="fromHand">
          <div v-if="collaborator" class="card collaborator-card" :data-agent="collaborator.agent" :data-state="collaborator.state">
            <span class="eyebrow">协作者 · {{ collaborator.state === 'running' ? '工作中' : collaborator.state === 'done' ? '完成' : '没有完成' }}</span>
            <strong><i class="agent-dot" />{{ collaborator.label }}<small v-if="collaborator.provider"> · {{ collaborator.provider }}</small></strong>
            <span class="small muted">{{ collaborator.line }}<template v-if="collaborator.step"> · 第 {{ collaborator.step }} 步</template></span>
          </div>
        </Transition>

        <TransitionGroup :css="false" @enter="fromHand"><ApprovalCard v-for="approval in snapshot.approvals" :key="approval.id" :approval="approval" @decide="(allow, scope) => decide(approval.id, allow, scope)" /></TransitionGroup>

        <div v-if="running || callTools.length" class="card activity-card">
          <span class="eyebrow">{{ running ? '正在做' : '刚才做了' }}</span>
          <ol class="tool-trail">
            <li v-for="tool in callTools.slice(-6)" :key="tool.callId" :class="{ failed: resultFor(tool.callId)?.isError, pending: !resultFor(tool.callId) }"><b>{{ toolLabels[tool.name] ?? tool.name }}</b><span>{{ summarize(tool) }}</span></li>
          </ol>
          <button class="link" @click="drawer = 'work'">查看完整过程 →</button>
        </div>

        <Transition :css="false" @enter="fromHand"><ResultCard v-if="snapshot.result && !running" :key="snapshot.result.taskId" :result="snapshot.result" :error="error" @changes="showChanges" @undo="undo" /></Transition>

        <div v-if="snapshot.queue.length" class="card queue-card"><span class="eyebrow">排队中</span><p v-for="(item, index) in snapshot.queue" :key="index" class="small">{{ index + 1 }}. {{ item.slice(0, 60) }}</p></div>

        <button class="card workspace-card" @click="pluginsOpen = true">
          <span class="eyebrow">{{ snapshot.workspace.trusted ? '已信任的工作文件夹' : '未信任的工作文件夹' }}</span>
          <strong>{{ workspaceName }}</strong>
          <span class="small muted">{{ modes[mode].label }}模式 · {{ snapshot.platform.sandbox.available ? '命令在沙箱中运行' : '没有命令沙箱' }}</span>
        </button>
      </aside>
    </section>

    <svg class="stage-overlay" aria-hidden="true"><path v-if="tail" class="speech-tail" :d="tail" /><path v-for="(line, index) in tethers" :key="index" class="tether" :class="line.kind" :d="line.d" /></svg>

    <footer class="dock">
      <p v-if="web" class="web-notice">在线体验 · 每位访客有独立的电脑账号和示例项目，闲置 2 小时后清理，请勿输入敏感信息。喜欢她的话，<a href="https://anna.mayuanyuan.top/#download" target="_blank" rel="noopener">下载桌面版 ↗</a>，或者到 <a href="https://github.com/YuanyuanMa03/anna" target="_blank" rel="noopener">GitHub ↗</a> 点个 Star。</p>
      <div v-if="web && quotaOut" class="setup-notice quota-notice" role="status"><span>在线体验今天的免费模型额度用完了，明天再来吧。等不及的话，可以下载桌面版，接上你自己的模型。</span><a href="https://anna.mayuanyuan.top/#download" target="_blank" rel="noopener">下载桌面版 ↗</a></div>
      <div v-if="notice" class="error" role="alert">{{ notice }}</div>
      <div v-if="update && ['available', 'downloading', 'ready', 'error'].includes(update.state)" class="setup-notice update-notice"><span>{{ update.state === 'available' ? `Anna ${update.version} 可以更新了${update.notes ? `：${update.notes}` : ''}` : update.state === 'downloading' ? `正在下载 Anna ${update.version}…` : update.message }}</span><button v-if="update.state === 'available'" @click="run({ type: 'update-install' })">{{ update.manual ? '下载新安装包' : '更新并重启' }}</button></div>
      <div v-if="error || snapshot.error" class="error" role="alert"><span>{{ error || snapshot.error }}</span><button v-if="snapshot.credential === 'rejected'" @click="settingsOpen = true">去设置</button></div>
      <div v-if="!canChat" class="setup-notice"><span>为 {{ character.name }} 连接一个真实模型，开始第一次对话。</span><button @click="settingsOpen = true">配置模型</button></div>
      <form class="composer" @submit.prevent="send()">
        <textarea v-model="input" aria-label="消息" :placeholder="needsTrust ? '先决定是否信任这个工作文件夹…' : running ? '补充或纠正指示，会插入正在进行的任务…' : `把要做的事交给${character.name}…（@claude、@codex 可以直接派给其他 agent）`" :disabled="configuring" @keydown.enter.exact.prevent="send()" />
        <div class="composer-actions">
          <ModeSwitch ref="modeSwitch" :mode="mode" :trusted="snapshot.workspace.trusted" :disabled="!canChat" @change="next => run({ type: 'mode', mode: next })" />
          <label><input v-model="autoSpeak" type="checkbox">朗读</label>
          <button v-if="running" type="button" @click="run({ type: 'stop' })">中断本轮</button>
          <button class="primary" :disabled="configuring || !input.trim() || !canChat || needsTrust" type="submit">{{ running ? '插话 ↗' : '发送 ↗' }}</button>
        </div>
      </form>
    </footer>

    <transition name="slide">
      <aside v-if="drawer" class="drawer" :aria-label="drawer === 'history' ? '对话记录' : drawer === 'changes' ? '改动' : '工作过程'">
        <div class="sheet-heading"><h2>{{ drawer === 'history' ? '对话记录' : drawer === 'changes' ? '这次的改动' : '工作过程' }}</h2><button class="icon-button" aria-label="关闭抽屉" @click="drawer = undefined">×</button></div>
        <div v-if="drawer === 'history'" ref="history" class="messages">
          <p v-if="!messages.length" class="muted">还没有对话。</p>
          <article v-for="(message, index) in messages" :key="index" class="message" :class="[message.role, { note: message.note, delegated: message.delegation }]"><span>{{ message.role === 'user' ? (message.origin === 'weixin' ? '你 · 微信' : '你') : message.delegation ? `${message.delegation.label}${message.delegation.provider ? ` · ${message.delegation.provider}` : ''} · ${message.delegation.steps} 步` : '伙伴' }}</span><p v-if="message.role === 'user' || message.note">{{ message.text }}</p><details v-else-if="message.delegation" class="delegation-block" :open="index === messages.length - 1"><summary>{{ message.delegation.status === 'completed' ? '完成' : message.delegation.status === 'aborted' ? '已停下' : '没有完成' }} · {{ message.delegation.task.slice(0, 60) }}</summary><div class="rich" v-html="renderMarkdown(message.text)" /></details><div v-else class="rich" v-html="renderMarkdown(message.text)" /></article>
          <p class="small muted">{{ snapshot.restored ? '会话已从上次恢复' : '新会话' }} · {{ snapshot.sessionId ?? '' }}</p>
        </div>
        <div v-else-if="drawer === 'changes'" class="tool-events">
          <p v-if="!changes.length" class="muted">没有可显示的改动。</p>
          <details v-for="change in changes" :key="change.path" open>
            <summary><b>{{ change.status === 'added' ? '新增' : change.status === 'deleted' ? '删除' : '修改' }}</b> {{ change.path }} <small class="plus">+{{ change.added }}</small> <small class="minus">−{{ change.removed }}</small></summary>
            <pre class="diff"><span v-for="(line, index) in change.patch.split('\n').slice(2)" :key="index" :class="{ add: line.startsWith('+'), del: line.startsWith('-'), hunk: line.startsWith('@@') }">{{ line }}
</span></pre>
          </details>
        </div>
        <div v-else class="tool-events">
          <p v-if="!tools.length" class="muted">本轮没有实际工具调用</p>
          <details v-for="tool in callTools" :key="tool.callId" :open="callTools.length < 4">
            <summary :class="{ failed: resultFor(tool.callId)?.isError }"><b>{{ toolLabels[tool.name] ?? tool.name }}</b> {{ summarize(tool) }}</summary>
            <pre>{{ tool.text }}</pre>
            <pre v-if="resultFor(tool.callId)" class="result">{{ resultFor(tool.callId)!.text }}</pre>
          </details>
        </div>
      </aside>
    </transition>

    <div v-if="weixinOpen" class="sheet-backdrop" @click.self="weixinOpen = false"><section class="sheet weixin-sheet" role="dialog" aria-modal="true" aria-label="微信连接"><div class="sheet-heading"><div><h2>在微信里给 {{ character.name }} 派活</h2><p class="muted">微信 → 我 → 设置 → 插件 → ClawBot</p></div><button class="icon-button" aria-label="关闭微信连接" @click="weixinOpen = false">×</button></div><img v-if="weixin.qr" class="weixin-qr" :src="weixin.qr" alt="微信 ClawBot 登录二维码"><p role="status">{{ weixin.message }}</p><form v-if="weixin.phase === 'need-code'" @submit.prevent="run({ type: 'weixin-code', code: verifyCode })"><input v-model="verifyCode" aria-label="微信验证码" inputmode="numeric"><button>提交验证码</button></form><button v-if="weixin.phase !== 'connected'" :disabled="weixin.phase === 'loading'" @click="run({ type: 'weixin-login' })">刷新登录二维码</button><button v-else @click="run({ type: 'weixin-disconnect' })">断开微信连接</button><p class="small muted">绑定后只响应扫码的账号。直接发任务即可；{{ character.name }} 忙时会排队并立即回执。微信任务始终按“谨慎”模式执行。<br>/status 看进度 · /stop 停止 · 授权请求回复 1 允许、0 拒绝（高风险操作仍需在桌面确认）。<br>Anna 需保持运行。</p></section></div>
    <SettingsPanel v-if="settingsOpen" :snapshot="snapshot" :busy="configuring || running" @close="settingsOpen = false" @command="run" />
    <AgentsSheet v-if="agentsOpen" :snapshot="snapshot" :locked="configuring || running" :error="error" @close="agentsOpen = false" @command="run" />
    <CapabilitiesSheet v-if="pluginsOpen" :snapshot="snapshot" :locked="configuring || running" :error="error" @close="pluginsOpen = false" @command="run" />
  </main>
  <main v-else class="boot">Anna 正在醒来…<p v-if="error">{{ error }}</p></main>
</template>
