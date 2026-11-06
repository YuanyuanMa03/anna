<script setup lang="ts">
import type { BrainChoice } from '../../../packages/agents/brains'
import type { CaptionPlace } from '../../../packages/character/layout'
import type { CompanionForm, MotionCue } from '../../../packages/character/manifest'
import type { AnnaPhase, AnnaState, ApprovalScope, Command, FileChange, MemoryDraft, Message, PermissionMode, RuntimeSnapshot, ToolActivity, WeixinState } from '../../../packages/shared/contracts'
import type { Anchors } from './character-stage.vue'
import type { MyAvatar } from './my-avatar'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { version } from '../../../package.json'
import { brainChoices, recommendedBrain } from '../../../packages/agents/brains'
import { captionPlace } from '../../../packages/character/layout'
import { companion } from '../../../packages/character/manifest'
import { renderMarkdown } from '../../../packages/character/markdown'
import { modes } from '../../../packages/permissions/modes'
import BodyStage from './body-stage.vue'
import CharacterStage from './character-stage.vue'
import AgentsSheet from './components/agents-sheet.vue'
import ApprovalCard from './components/approval-card.vue'
import AvatarMaker from './components/avatar-maker.vue'
import CapabilitiesSheet from './components/capabilities-sheet.vue'
import LifeSheet from './components/life-sheet.vue'
import ModeSwitch from './components/mode-switch.vue'
import ResultCard from './components/result-card.vue'
import VoiceSheet from './components/voice-sheet.vue'
import { modelSpeech } from './model-speech'
import { forgetMyAvatar, readMyAvatar, saveMyAvatar } from './my-avatar'

const phaseLabels: Record<AnnaPhase, string> = { offline: '休息中', idle: '在这儿', thinking: '思考中', responding: '正在回答', inspecting: '查看资料', editing: '修改文件', running: '运行命令', testing: '验证中', waiting: '等你确认', compacting: '整理上下文', retrying: '重试中', supervising: '督工中', reviewing: '审阅中', done: '完成了', failed: '遇到问题' }
const toolLabels: Record<string, string> = { read: '读取', ls: '列目录', find: '查找', grep: '搜索', edit: '修改', write: '写入', bash: '终端', powershell: '终端', anna_status: '状态', anna_memory: '记忆', anna_delegate: '派活' }

const snapshot = ref<RuntimeSnapshot>()
const messages = ref<Message[]>([])
const settingsOpen = ref(false)
const voiceOpen = ref(false)
// Always start muted, including a restart on a remote workstation.
const voiceEnabled = ref(false)
const speaking = ref(false)
const voiceLevel = ref(0)
const voicePlayer = modelSpeech(request => window.anna.voice(request), (value) => { speaking.value = value }, (value) => { voiceLevel.value = value })
function toggleVoice() {
  voiceEnabled.value = !voiceEnabled.value
  if (!voiceEnabled.value)
    voicePlayer.stop()
}
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
const now = ref(Date.now())
const history = ref<HTMLDivElement>()
const bubble = ref<HTMLDivElement>()
const modeSwitch = ref<InstanceType<typeof ModeSwitch>>()
let release: (() => void) | undefined
let clock: number | undefined

const character = computed(() => companion(snapshot.value?.settings.characterId))
/** Her own body (a mesh avatar of her original art) or the Live2D anime form; a per-machine preference. */
const form = ref<CompanionForm>(readForm())
const bodyFailure = ref('')
/** The look the person made for her, and whether it has been looked for yet, so the stage does not open on the wrong form. */
const mine = ref<MyAvatar>()
const avatarChecked = ref(false)
const makerOpen = ref(false)
const shownBody = computed(() => form.value === 'mine' && mine.value ? mine.value : character.value.body)
const usesBody = computed(() => form.value !== 'anime' && !bodyFailure.value && (form.value === 'body' || Boolean(mine.value)))
/** Each new look gets a new stage: the runtime keeps what it has loaded. */
const mineVersion = ref(0)
void readMyAvatar().catch(() => undefined).then((saved) => {
  mine.value = saved
  if (!saved && form.value === 'mine')
    form.value = 'body'
  avatarChecked.value = true
})
function bodyUnavailable(reason: string) {
  // Her own body is the way back from a look that will not show; the anime form is the way back from her body.
  if (form.value === 'mine') {
    notice.value = `你做的形象显示不了（${reason}），先换回她的本体。`
    form.value = 'body'
  }
  else { bodyFailure.value = reason }
}
async function madeAvatar(avatar: MyAvatar) {
  makerOpen.value = false
  await saveMyAvatar(avatar).catch((cause: Error) => { notice.value = `这个形象没能保存，下次打开就没有了：${cause.message}` })
  mine.value = avatar
  mineVersion.value++
  chooseForm('mine')
  play('greet')
}
async function forgetAvatar() {
  await forgetMyAvatar().catch(() => {})
  mine.value = undefined
  if (form.value === 'mine')
    chooseForm('body')
}
function readForm() {
  try {
    const saved = localStorage.getItem('anna.form')
    return saved === 'anime' || saved === 'mine' ? saved : 'body'
  }
  catch { return 'body' }
}
function chooseForm(next: CompanionForm) {
  form.value = next
  bodyFailure.value = ''
  try { localStorage.setItem('anna.form', next) }
  catch {}
}
/** The person is typing to her: she looks down at what is being written. */
const typedAt = ref(0)
const listening = computed(() => Boolean(input.value.trim()) && now.value - typedAt.value < 3000)
/** What a newcomer can say to her: greet her first, then ask, then hand her something to do. */
const suggestions = computed(() => snapshot.value?.starterTasks ?? ['看看这个工作文件夹里有什么，给我一个概览'])
const delegates = computed(() => snapshot.value?.agents.detected.filter(agent => agent.installed && agent.tier === 'delegate').length ?? 0)
/** Who she can think with on this machine, and the one to offer someone whose pi has no model yet. */
const brains = computed(() => snapshot.value ? brainChoices({ detected: snapshot.value.agents.detected, current: snapshot.value.settings.kernel, hasKey: snapshot.value.hasKey, sandbox: snapshot.value.platform.sandbox.available, acp: snapshot.value.platform.acp }) : [])
const recommended = computed(() => recommendedBrain(brains.value))
const running = computed(() => snapshot.value?.state === 'running')
const configuring = computed(() => busy.value || snapshot.value?.state === 'starting')
const mode = computed<PermissionMode>(() => snapshot.value?.mode ?? 'ask')
/** pi needs a model key; an external brain uses its own login. */
const canChat = computed(() => Boolean(snapshot.value && (snapshot.value.hasKey || snapshot.value.settings.kernel !== 'pi')))
const needsTrust = computed(() => Boolean(snapshot.value && snapshot.value.settings.workspace && !snapshot.value.workspace.known))
const connected = computed(() => snapshot.value?.state === 'ready' || snapshot.value?.state === 'running')
/** What the running brain reports, or the model pi is set up with; pi's settings say nothing about another brain, or before it has a key. */
const modelName = computed(() => snapshot.value?.actualModel ?? snapshot.value?.model?.id ?? (snapshot.value?.settings.kernel === 'pi' && snapshot.value.hasKey ? snapshot.value.settings.model.model : ''))
/** Honest connection label: a saved key is only "connected" once a real reply came back. */
const connection = computed(() => {
  const state = snapshot.value?.state
  if (connected.value)
    return snapshot.value?.credential === 'rejected' ? '密钥被拒绝' : snapshot.value?.credential === 'unverified' ? '已就绪 · 未验证' : snapshot.value?.settings.kernel.startsWith('acp:') ? '已连接 · 未实测' : '已连接'
  return state === 'starting' ? '正在连接' : state === 'error' ? '连接出错' : '未连接'
})
const lastReply = computed(() => [...messages.value].reverse().find(message => message.role === 'assistant' && !message.note)?.text ?? '')
const subtitle = computed(() => {
  if (running.value)
    return stream.value
  if (modeLine.value && now.value - modeLine.value.at < 4500)
    return modeLine.value.text
  if (snapshot.value?.error)
    return snapshot.value.credential === 'rejected' ? '我连不上模型：密钥被服务商拒绝了。到“模型与设置”里换一个吧。' : '这一轮没有成功，原因写在下面。'
  return lastReply.value || (canChat.value ? snapshot.value?.welcome ?? character.value.greeting : '先给我接上一个模型，我们就能开始了。')
})
/** Her words fade once she has said them and the moment has passed; hovering or anything new brings them back. */
const subtitleAt = ref(Date.now())
watch(subtitle, () => { subtitleAt.value = Date.now() })
const quiet = computed(() => !running.value && !speaking.value && now.value - subtitleAt.value > 15_000 && Boolean(messages.value.length))
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
// ── Stage interaction: words float beside her face, cards come from her hand ─────────
const anchors = ref<Anchors>({})
const cue = ref<{ kind: MotionCue, at: number }>()
const place = ref<CaptionPlace>()
/** Your words, drifting up toward her after you send them, then gone. */
const drifts = ref<{ id: number, text: string }[]>([])
let driftId = 0
const timers = new Set<number>()
const menuOpen = ref(false)
const menuList = ref<HTMLElement>()
const brainOpen = ref(false)
function play(kind: MotionCue) { cue.value = { kind, at: Date.now() } }
function drift(text: string) {
  const id = ++driftId
  drifts.value = [...drifts.value, { id, text }]
  const timer = window.setTimeout(() => {
    timers.delete(timer)
    drifts.value = drifts.value.filter(item => item.id !== id)
  }, 2600)
  timers.add(timer)
}
function placeCaption() {
  const box = bubble.value?.parentElement?.getBoundingClientRect()
  if (!box)
    return
  // The width she would like matches .speech's initial width in style.css.
  const next = captionPlace({ mouth: anchors.value.mouth, clearance: anchors.value.clearance, viewport: { width: window.innerWidth, height: window.innerHeight }, size: { width: Math.min(380, window.innerWidth * 0.34), height: box.height } })
  // Anchors arrive several times a second; only a real move (more than a couple of pixels) re-places her words.
  const moved = !place.value || place.value.side !== next.side || Math.abs(place.value.left - next.left) + Math.abs(place.value.top - next.top) + Math.abs(place.value.width - next.width) > 2
  if (moved)
    place.value = next
}
function onAnchors(next: Anchors) {
  anchors.value = next
  placeCaption()
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
  const ownsBusy = !['avatar-job', 'model-list', 'approval', 'send', 'stop', 'mode', 'changes', 'rule-remove', 'memory-forget', 'weixin-status', 'weixin-login', 'weixin-code', 'weixin-disconnect'].includes(command.type)
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
  voicePlayer.stop()
  input.value = ''
  if (!running.value) {
    tools.value = []
    stream.value = ''
    collaborator.value = undefined
  }
  drift(body)
  void run({ type: 'send', text: body })
}
function askForAvatar(image: string) {
  makerOpen.value = false
  if (!running.value) {
    tools.value = []
    stream.value = ''
    collaborator.value = undefined
  }
  void run({ type: 'avatar-job', image })
}
/** Opens one of the places behind the corner menu and closes the menu. */
function openFromMenu(action: () => void) {
  menuOpen.value = false
  action()
}
/**
 * A brain that can think takes over now; pi without a model opens its settings; an agent that is missing or signed out opens
 * the agents sheet, where it can be installed or its login checked.
 */
function pickBrain(choice: BrainChoice) {
  brainOpen.value = false
  settingsOpen.value = true
  if (choice.state === 'needs-key') {
    // pi's model form only shows while pi is her brain.
    if (!choice.current)
      void run({ type: 'kernel', id: choice.id })
    settingsOpen.value = true
  }
  else if (choice.state === 'missing' || choice.state === 'signed-out') {
    void run({ type: 'snapshot' }).then(() => { agentsOpen.value = true })
  }
  else if (!choice.current) {
    void run({ type: 'kernel', id: choice.id })
  }
}
const decide = (id: string, allow: boolean, scope: ApprovalScope, memory?: MemoryDraft) => run({ type: 'approval', id, allow, scope, memory })
async function showChanges() {
  if (snapshot.value?.result && await run({ type: 'changes', taskId: snapshot.value.result.taskId }))
    drawer.value = 'changes'
}
const undo = (force: boolean) => snapshot.value?.result && run({ type: 'undo', taskId: snapshot.value.result.taskId, force })
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    document.querySelector<HTMLElement>('.corner [aria-expanded="true"]')?.focus()
    menuOpen.value = brainOpen.value = false
  }
  if (event.key === 'Tab' && event.shiftKey && canChat.value) {
    event.preventDefault()
    modeSwitch.value?.cycle()
  }
}

onMounted(async () => {
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
      case 'stream': stream.value = event.text; break
      case 'result':
        if (voiceEnabled.value && event.result.status === 'completed' && event.result.origin === 'desktop' && event.reply)
          void voicePlayer.speak(event.reply).catch((cause: Error) => { notice.value = cause.message })
        break
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
  await run({ type: 'weixin-status' })
  if (canChat.value)
    await run({ type: 'connect' })
})
watch(() => messages.value.length, () => { void scrollHistory() })
watch(input, () => { typedAt.value = Date.now() })
// Opening the corner menu or the brain list moves focus to its first entry, so both work from the keyboard.
watch([menuOpen, brainOpen], async ([menu, brain]) => {
  if (!menu && !brain)
    return
  await nextTick()
  menuList.value?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
})
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
watch(subtitle, async () => { await nextTick(); bubble.value?.scrollTo({ top: running.value ? bubble.value.scrollHeight : 0 }) })
onBeforeUnmount(() => { voicePlayer.stop(); window.removeEventListener('keydown', keydown); release?.(); window.clearInterval(clock); timers.forEach(timer => window.clearTimeout(timer)) })
</script>

<template>
  <main v-if="snapshot" class="app-shell" :class="{ 'life-onboarding': !snapshot.settings.onboardingComplete || snapshot.settings.firstTaskPending }" :data-phase="anna.phase" :data-mode="mode">
    <header class="corner">
      <div class="brand">anna<span>v{{ version }}</span></div>
      <span class="connection" :title="snapshot.model ? `${snapshot.kernel.label} · ${snapshot.model.id} · 思考 ${snapshot.model.thinking}` : modelName"><i :class="{ online: connected && snapshot.credential !== 'unverified' && snapshot.credential !== 'rejected', bad: snapshot.credential === 'rejected' || snapshot.state === 'error' }" />{{ connection }}<template v-if="modelName"> · {{ modelName }}</template></span>
      <div class="corner-actions">
        <div class="menu">
          <button class="brain-chip" :title="`${character.name} 现在用 ${snapshot.kernel.label} 思考`" :aria-expanded="brainOpen" @click="settingsOpen = true; menuOpen = false"><i />Anna 档案 ▾</button>
          <div v-if="brainOpen" class="menu-backdrop" @click="brainOpen = false" />
          <nav v-if="brainOpen" ref="menuList" class="menu-list brain-list" :aria-label="`${character.name} 用谁来思考`">
            <span class="menu-title">{{ character.name }} 用谁来思考</span>
            <button v-for="choice in brains" :key="choice.id" :data-brain="choice.id" :data-state="choice.state" :aria-pressed="choice.current" :disabled="configuring || running" @click="pickBrain(choice)"><strong>{{ choice.label }}</strong><small>{{ choice.note }}{{ choice.hint && ` · ${choice.hint}` }}</small></button>
            <button class="more" @click="brainOpen = false; settingsOpen = true">模型与设置…</button>
          </nav>
        </div>
        <div class="menu">
          <button class="menu-button" aria-label="更多" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen; brainOpen = false">更多<small v-if="callTools.length">{{ callTools.length }}</small></button>
          <div v-if="menuOpen" class="menu-backdrop" @click="menuOpen = false" />
          <nav v-if="menuOpen" ref="menuList" class="menu-list" aria-label="更多">
            <button @click="openFromMenu(() => drawer = 'history')">对话记录</button>
            <button @click="openFromMenu(() => drawer = 'work')">工作过程<small v-if="callTools.length">{{ callTools.length }}</small></button>
            <button @click="openFromMenu(() => { weixinOpen = true; run({ type: weixin.phase === 'offline' ? 'weixin-login' : 'weixin-status' }) })"><i class="dot" :class="{ online: weixin.phase === 'connected' }" />微信</button>
            <button @click="openFromMenu(() => { agentsOpen = true; run({ type: 'snapshot' }) })">外部 agent<small v-if="delegates">{{ delegates }}</small></button>
            <button @click="openFromMenu(() => makerOpen = true)">创造我的 {{ character.name }}</button>
            <button @click="openFromMenu(() => pluginsOpen = true)">外观与能力</button>
            <button @click="openFromMenu(() => settingsOpen = true)">模型与设置</button>
          </nav>
        </div>
      </div>
    </header>

    <section class="scene" :data-form="usesBody ? 'body' : 'anime'" :aria-label="`${character.name} 的舞台`">
      <div class="stage">
        <div class="stage-halo" />
        <BodyStage v-if="avatarChecked && usesBody" :key="form === 'mine' ? `mine-${mineVersion}` : form" :body="shownBody!" :name="character.name" :phase="anna.phase" :mode="mode" :speaking="speaking" :voice-level="voiceLevel" :listening="listening" :align="0.5" :cue="cue" @poke="drawer = 'work'" @anchors="onAnchors" @unavailable="bodyUnavailable" />
        <CharacterStage v-else-if="avatarChecked" :character="character" :phase="anna.phase" :mode="mode" :speaking="speaking" :voice-level="voiceLevel" :zoom="1.7" :align="0.5" :cue="cue" @poke="drawer = 'work'" @anchors="onAnchors" />
        <div class="status-ribbon" role="status" :data-phase="anna.phase"><em class="mode-badge" :data-mode="mode">{{ modes[mode].label }}</em><i />{{ phaseLabels[anna.phase] }}<span v-if="anna.line">· {{ anna.line }}</span><b v-if="running && anna.step">第 {{ anna.step }} 步</b></div>
      </div>

      <!-- Her words float beside her face; older lines fade out above. -->
      <div class="speech" :class="[place?.side ?? 'left', { live: running, quiet }]" :style="place && { left: `${place.left}px`, top: `${place.top}px`, width: `${place.width}px` }">
        <span class="speaker">{{ character.name }}</span>
        <div ref="bubble" class="bubble" tabindex="0" aria-live="polite"><div v-if="subtitle" class="rich" v-html="renderMarkdown(subtitle)" /><p v-else class="typing"><i /><i /><i /></p></div>
        <div v-if="!messages.length && canChat && !running && !needsTrust" class="suggestions"><span>你可以对 {{ character.name }} 说</span><button v-for="item in suggestions" :key="item" @click="send(item)">「{{ item }}」</button></div>
      </div>
      <div class="drifts" aria-hidden="true"><p v-for="item in drifts" :key="item.id" class="drift">{{ item.text }}</p></div>

      <aside class="props" :aria-label="`${character.name} 手上的事`">
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

        <TransitionGroup :css="false" @enter="fromHand"><ApprovalCard v-for="approval in snapshot.approvals" :key="approval.id" :approval="approval" @decide="(allow, scope, memory) => decide(approval.id, allow, scope, memory)" /></TransitionGroup>

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

    <footer class="dock">
      <div v-if="notice" class="error" role="alert">{{ notice }}</div>
      <div v-if="update && ['available', 'downloading', 'ready', 'error'].includes(update.state)" class="setup-notice update-notice"><span>{{ update.state === 'available' ? `Anna ${update.version} 可以更新了${update.notes ? `：${update.notes}` : ''}` : update.state === 'downloading' ? `正在下载 Anna ${update.version}…` : update.message }}</span><button v-if="update.state === 'available'" @click="run({ type: 'update-install' })">{{ update.manual ? '下载新安装包' : '更新并重启' }}</button></div>
      <div v-if="error || snapshot.error" class="error" role="alert"><span>{{ error || snapshot.error }}</span><button v-if="snapshot.credential === 'rejected'" @click="settingsOpen = true">去设置</button></div>
      <div v-if="!canChat" class="setup-notice"><span>为 {{ character.name }} 连接一个真实模型，开始第一次对话。<template v-if="recommended">这台电脑上的 {{ recommended.label }} 已经登录，可以直接用它思考。</template></span><button v-if="recommended" class="primary" :disabled="configuring" @click="pickBrain(recommended)">用 {{ recommended.label }} 思考</button><button @click="settingsOpen = true">配置模型</button></div>
      <form class="composer" @submit.prevent="send()">
        <textarea v-model="input" aria-label="消息" rows="1" :placeholder="needsTrust ? '先决定是否信任这个工作文件夹…' : running ? '补充或纠正指示，会插入正在进行的任务…' : `对 ${character.name} 说点什么…（@claude、@codex 派活）`" :disabled="configuring" @keydown.enter.exact.prevent="send()" />
        <div class="composer-actions">
          <button type="button" @click="voiceOpen = true">语音对话</button>
          <button type="button" :aria-pressed="voiceEnabled" @click="toggleVoice">{{ voiceEnabled ? '关闭模型语音' : '开启模型语音' }}</button>
          <button v-if="voiceEnabled" type="button" @click="voicePlayer.stop()">停止说话</button>
          <ModeSwitch ref="modeSwitch" :mode="mode" :trusted="snapshot.workspace.trusted" :platform="snapshot.platform.os" :sandboxed="snapshot.platform.sandbox.available" :auto-acknowledged="snapshot.settings.windowsAutoAcknowledged" :disabled="!canChat" @change="(next, acknowledge) => run({ type: 'mode', mode: next, acknowledge })" />
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
          <article v-for="(message, index) in messages" :key="index" class="message" :class="[message.role, { note: message.note, delegated: message.delegation }]"><span>{{ message.role === 'user' ? (message.origin === 'weixin' ? '你 · 微信' : '你') : message.delegation ? `${message.delegation.label}${message.delegation.provider ? ` · ${message.delegation.provider}` : ''} · ${message.delegation.steps} 步` : character.name }}</span><p v-if="message.role === 'user' || message.note">{{ message.text }}</p><details v-else-if="message.delegation" class="delegation-block" :open="index === messages.length - 1"><summary>{{ message.delegation.status === 'completed' ? '完成' : message.delegation.status === 'aborted' ? '已停下' : '没有完成' }} · {{ message.delegation.task.slice(0, 60) }}</summary><div class="rich" v-html="renderMarkdown(message.text)" /></details><div v-else class="rich" v-html="renderMarkdown(message.text)" /></article>
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
    <VoiceSheet v-if="voiceOpen" :can-talk="canChat && !needsTrust && !running && !configuring" @close="voiceOpen = false" @transcript="text => { input = text; voiceOpen = false }" @talk="text => { input = text; voiceEnabled = true; voiceOpen = false; send() }" />
    <LifeSheet v-if="settingsOpen || !snapshot.settings.onboardingComplete || snapshot.settings.firstTaskPending" :snapshot="snapshot" :busy="configuring || running" :error="error" @close="settingsOpen = false" @command="async command => { if (await run(command) && command.type === 'personality') settingsOpen = false }" />
    <AgentsSheet v-if="agentsOpen" :snapshot="snapshot" :locked="configuring || running" :error="error" @close="agentsOpen = false" @command="run" />
    <CapabilitiesSheet v-if="pluginsOpen" :snapshot="snapshot" :locked="configuring || running" :error="error" :form="usesBody ? form : 'anime'" :has-mine="Boolean(mine)" :body-failure="bodyFailure" @close="pluginsOpen = false" @command="run" @form="chooseForm" @make="pluginsOpen = false; makerOpen = true" @forget="forgetAvatar" />
    <AvatarMaker v-if="makerOpen" :name="character.name" :can-ask="canChat && !running && Boolean(snapshot?.workspace.trusted) && mode !== 'plan'" @close="makerOpen = false" @made="madeAvatar" @ask="askForAvatar" />
  </main>
  <main v-else class="boot">Anna 正在醒来…<p v-if="notice" role="alert">{{ notice }}</p><p v-else-if="error" role="alert">{{ error }}</p></main>
</template>
