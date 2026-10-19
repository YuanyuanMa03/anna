<script setup lang="ts">
import type { AnnaPhase, PermissionMode } from '../../packages/shared/contracts'
import type { Lang } from './copy'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CharacterStage from '../../apps/desktop/src/character-stage.vue'
import { characters } from '../../packages/character/manifest'
import { copy, modeOrder, modes } from './copy'

const repo = 'https://github.com/YuanyuanMa03/anna'
const studio = 'https://modelscope.cn/studios/mayy101184/anna'

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('anna-lang')
    if (saved === 'zh' || saved === 'en')
      return saved
  }
  catch {}
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
const lang = ref<Lang>(initialLang())
const t = computed(() => copy[lang.value])
watch(lang, (value) => {
  document.documentElement.lang = copy[value].meta.lang
  document.title = copy[value].meta.title
  try {
    localStorage.setItem('anna-lang', value)
  }
  catch {}
}, { immediate: true })

// ── Demo: a scripted task that obeys the same policy table as the app ──
type Kind = 'inspect' | 'edit' | 'network' | 'verify'
type Decision = 'allow' | 'ask' | 'deny'
type Status = 'running' | 'waiting' | 'done' | 'denied' | 'blocked'
interface Step { kind: Kind, tool: 'read' | 'write' | 'edit' | 'shell', target: string, phase: AnnaPhase, change?: { path: string, status: 'added' | 'modified', stat: string } }
interface Entry { step: Step, status: Status }

const policy: Record<PermissionMode, Record<Kind, Decision>> = {
  plan: { inspect: 'allow', edit: 'deny', network: 'deny', verify: 'deny' },
  ask: { inspect: 'allow', edit: 'ask', network: 'ask', verify: 'ask' },
  edit: { inspect: 'allow', edit: 'allow', network: 'ask', verify: 'allow' },
  auto: { inspect: 'allow', edit: 'allow', network: 'allow', verify: 'allow' },
}
const tasks: { actor: 'anna' | 'claude', steps: Step[] }[] = [
  { actor: 'anna', steps: [
    { kind: 'inspect', tool: 'read', target: 'tasks.txt', phase: 'inspecting' },
    { kind: 'edit', tool: 'write', target: 'notes.md', phase: 'editing', change: { path: 'notes.md', status: 'added', stat: '+12 −0' } },
    { kind: 'network', tool: 'shell', target: 'pnpm add dayjs', phase: 'running', change: { path: 'package.json', status: 'modified', stat: '+1 −0' } },
    { kind: 'verify', tool: 'shell', target: 'pnpm test', phase: 'testing' },
  ] },
  { actor: 'claude', steps: [
    { kind: 'inspect', tool: 'read', target: 'src/todo.ts', phase: 'supervising' },
    { kind: 'edit', tool: 'edit', target: 'src/todo.ts', phase: 'supervising', change: { path: 'src/todo.ts', status: 'modified', stat: '+3 −1' } },
    { kind: 'verify', tool: 'shell', target: 'pnpm test', phase: 'supervising' },
  ] },
]

const mode = ref<PermissionMode>('ask')
const taskIndex = ref(0)
const task = computed(() => tasks[taskIndex.value]!)
const characterIndex = ref(0)
const character = computed(() => characters[characterIndex.value]!)

// ── Cast: the five companions as cut-outs captured from the app, standing on one baseline ──
// `top` is how much of the stage each model fills, `size` the cut-out's own pixels, `overlap` how far it tucks in
// behind its left neighbour (Mao's wand reaches far to the left).
const cast = [
  { id: 'natori', top: 0.913, size: [434, 900], z: 1, overlap: 0 },
  { id: 'mao', top: 0.896, size: [898, 900], z: 3, overlap: 0.36 },
  { id: 'haru', top: 0.941, size: [293, 900], z: 6, overlap: 0.07 },
  { id: 'chitose', top: 0.927, size: [651, 900], z: 2, overlap: 0.12 },
  { id: 'mark', top: 0.72, size: [581, 879], z: 4, overlap: 0.14 },
] as const
const castRow = ref<HTMLElement>()
function meet(id: string) {
  characterIndex.value = Math.max(0, characters.findIndex(item => item.id === id))
  document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' })
}
// On a phone the cast scrolls sideways; start with Anna in the middle.
onMounted(() => {
  const row = castRow.value
  const lead = row?.querySelector<HTMLElement>('.lead')
  if (row && lead && row.scrollWidth > row.clientWidth)
    row.scrollLeft = lead.offsetLeft - (row.clientWidth - lead.clientWidth) / 2
})
const phase = ref<AnnaPhase>('idle')
const line = ref('')
const entries = ref<Entry[]>([])
const running = ref(false)
const finished = ref(false)
const undone = ref(false)
const pending = ref<Entry>()
let answer: ((allow: boolean) => void) | undefined
let run = 0

const changes = computed(() => entries.value.filter(entry => entry.status === 'done' && entry.step.change).map(entry => entry.step.change!))
const bubble = computed(() => line.value || t.value.demo.lines.idle(t.value.cast.people[character.value.id].name))

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
function reset() {
  run++
  answer?.(false)
  answer = undefined
  pending.value = undefined
  running.value = false
  finished.value = false
  undone.value = false
  entries.value = []
  phase.value = 'idle'
  line.value = ''
}
async function start() {
  reset()
  const id = run
  const alive = () => id === run
  running.value = true
  const lines = t.value.demo.lines
  const delegated = task.value.actor === 'claude'
  phase.value = delegated ? 'supervising' : 'thinking'
  line.value = delegated ? lines.supervising : lines.thinking
  await sleep(1100)
  let denied = 0
  for (const step of task.value.steps) {
    if (!alive())
      return
    const decision = policy[mode.value][step.kind]
    const entry: Entry = { step, status: 'running' }
    entries.value.push(entry)
    const live = entries.value.at(-1)!
    if (decision === 'deny') {
      live.status = 'blocked'
      await sleep(500)
      continue
    }
    if (decision === 'ask') {
      live.status = 'waiting'
      pending.value = live
      phase.value = 'waiting'
      line.value = lines.waiting
      const allow = await new Promise<boolean>(resolve => (answer = resolve))
      if (!alive())
        return
      pending.value = undefined
      if (!allow) {
        live.status = 'denied'
        denied++
        await sleep(350)
        continue
      }
      live.status = 'running'
    }
    phase.value = step.phase
    line.value = delegated ? lines.supervising : ''
    await sleep(mode.value === 'auto' ? 750 : 1050)
    if (!alive())
      return
    live.status = 'done'
  }
  const files = changes.value.length
  phase.value = 'done'
  line.value = mode.value === 'plan' && !delegated ? lines.plan : delegated ? lines.claude(files, denied) : lines.done(files, denied)
  running.value = false
  finished.value = true
}
function decide(allow: boolean) {
  const resolve = answer
  answer = undefined
  resolve?.(allow)
}
function undo() {
  undone.value = true
  line.value = t.value.demo.undone
}
watch([mode, taskIndex], reset)
watch(lang, () => {
  if (!running.value && !finished.value)
    line.value = ''
})
onBeforeUnmount(reset)

// ── Install commands ──
type Os = 'mac' | 'linux' | 'win'
const ua = navigator.userAgent
const os = ref<Os>(/Windows/i.test(ua) ? 'win' : /Linux|X11/i.test(ua) && !/Android/i.test(ua) ? 'linux' : 'mac')
const osNames: Record<Os, string> = { mac: 'macOS', linux: 'Linux', win: 'Windows' }
// Installer names carry no version, so these links always point at the newest release.
const installers: Record<Os, string> = {
  mac: `${repo}/releases/latest/download/Anna-mac-arm64.dmg`,
  linux: `${repo}/releases/latest/download/Anna-linux-amd64.deb`,
  win: `${repo}/releases/latest/download/Anna-Setup-windows-x64.exe`,
}
const commands: Record<Os, string> = {
  mac: 'curl -fsSL https://anna.mayuanyuan.top/install.sh | bash',
  linux: 'curl -fsSL https://anna.mayuanyuan.top/install.sh | bash',
  win: 'irm https://anna.mayuanyuan.top/install.ps1 | iex',
}
const copied = ref('')
async function copyCommand(command: string) {
  try {
    await navigator.clipboard.writeText(command)
    copied.value = command
    setTimeout(() => copied.value = '', 1800)
  }
  catch {}
}

const support = ref<HTMLDialogElement>()
const payment = ref<'wechat' | 'alipay'>('wechat')
const year = new Date().getFullYear()
</script>

<template>
  <header class="nav">
    <a href="#" class="wordmark" :aria-label="t.nav.home">anna<span>v0.5</span></a>
    <nav :aria-label="t.nav.home">
      <a href="#meet">{{ t.nav.meet }}</a>
      <a href="#demo">{{ t.nav.demo }}</a>
      <a href="#features">{{ t.nav.features }}</a>
      <a href="#modes">{{ t.nav.modes }}</a>
      <a href="#download">{{ t.nav.download }}</a>
    </nav>
    <div class="nav-actions">
      <button class="sponsor-nav" @click="support?.showModal()">♥ <span>{{ t.nav.coffee }}</span></button>
      <button class="lang" :aria-label="lang === 'zh' ? 'Switch to English' : '切换到中文'" @click="lang = lang === 'zh' ? 'en' : 'zh'">{{ lang === 'zh' ? 'EN' : '中' }}</button>
      <a class="github" :href="repo" target="_blank" rel="noopener"><svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg><span>GitHub</span></a>
    </div>
  </header>

  <main>
    <section class="hero wrap">
      <div class="hero-copy">
        <p class="eyebrow"><span class="dot" />{{ t.hero.eyebrow }}</p>
        <h1><span>{{ t.hero.title[0] }}</span><br><em><span>{{ t.hero.title[1] }}</span></em></h1>
        <p class="lede">{{ t.hero.desc }}</p>
        <div class="actions">
          <a class="button primary" :href="installers[os]">{{ t.download.button(osNames[os]) }} <span>↓</span></a>
          <a class="button" :href="studio" target="_blank" rel="noopener">{{ t.hero.online }} <span>↗</span></a>
          <a class="button" href="#download">{{ t.hero.others }}</a>
          <a class="button" :href="repo" target="_blank" rel="noopener">{{ t.hero.github }} <span>↗</span></a>
        </div>
        <p class="sponsor-note"><span>♥</span>{{ t.hero.sponsor.text }} <button @click="support?.showModal()">{{ t.hero.sponsor.button }} →</button></p>
      </div>
    </section>

    <section class="cast wrap" :aria-label="t.cast.label">
      <div ref="castRow" class="cast-row">
        <button v-for="item in cast" :key="item.id" class="member" :class="{ lead: item.id === 'haru' }" :style="{ '--top': item.top, '--ratio': item.size[0] / item.size[1], '--overlap': item.overlap, 'zIndex': item.z }" :aria-label="`${t.cast.people[item.id].name} · ${t.cast.people[item.id].tagline}`" @click="meet(item.id)">
          <img :src="`/media/companions/${item.id}.webp`" alt="" :width="item.size[0]" :height="item.size[1]">
          <span class="tag"><b>{{ t.cast.people[item.id].name }}</b><small>{{ t.cast.people[item.id].tagline }}</small></span>
        </button>
      </div>
      <p class="cast-note">{{ t.cast.note }}</p>
    </section>

    <div class="strip wrap">
      <strong>{{ t.strip.lead }}</strong>
      <ul><li v-for="item in t.strip.items" :key="item">{{ item }}</li></ul>
    </div>

    <section class="shot wrap">
      <figure class="hero-shot">
        <div class="window">
          <div class="window-bar"><span class="traffic"><i /><i /><i /></span><span>{{ t.hero.shot }}</span></div>
          <img src="/media/work.webp" :alt="t.hero.shot" width="1600" height="858" loading="lazy">
        </div>
        <figcaption class="chip chip-a"><i class="mode-dot edit" />{{ t.hero.chips[0] }}</figcaption>
        <div class="chip chip-b">{{ t.hero.chips[1] }}</div>
      </figure>
    </section>

    <section id="meet" class="meet wrap">
      <div class="heading">
        <div><p class="eyebrow">{{ t.meet.eyebrow }}</p><h2>{{ t.meet.title[0] }}<br><em>{{ t.meet.title[1] }}</em></h2></div>
        <p>{{ t.meet.desc }}</p>
      </div>
      <div class="traits">
        <article v-for="item in t.meet.traits" :key="item.title"><span>{{ item.icon }}</span><h3>{{ item.title }}</h3><p>{{ item.body }}</p></article>
      </div>
    </section>

    <section id="demo" class="demo wrap">
      <div class="heading">
        <div><p class="eyebrow">{{ t.demo.eyebrow }}</p><h2>{{ t.demo.title[0] }}<br><em>{{ t.demo.title[1] }}</em></h2></div>
        <p>{{ t.demo.desc }}</p>
      </div>
      <div class="demo-shell" :data-mode="mode" :data-phase="phase">
        <div class="demo-stage">
          <div class="halo" />
          <div class="model"><CharacterStage :character="character" :phase="phase" :mode="mode" :speaking="running && phase !== 'waiting'" /></div>
          <div class="bubble" aria-live="polite"><span>{{ character.name }} · Anna</span><p>{{ bubble }}</p></div>
          <div class="ribbon"><b>{{ modes[mode].name[lang] }}</b>{{ modes[mode].stance[lang] }}</div>
          <div class="picker" :aria-label="t.demo.characters">
            <button v-for="(item, index) in characters" :key="item.id" :aria-pressed="characterIndex === index" :title="item.name" @click="characterIndex = index"><img :src="item.thumbnailPath" :alt="item.name"></button>
          </div>
        </div>
        <div class="demo-panel">
          <div class="mode-switch" role="radiogroup" :aria-label="t.nav.modes">
            <button v-for="item in modeOrder" :key="item" role="radio" :aria-checked="mode === item" :data-mode="item" @click="mode = item"><i class="mode-dot" :class="item" />{{ modes[item].name[lang] }}<small>{{ modes[item].hint[lang] }}</small></button>
          </div>
          <div class="task-pick">
            <span class="label">{{ t.demo.task }}</span>
            <button v-for="(item, index) in t.demo.tasks" :key="item" :aria-pressed="taskIndex === index" @click="taskIndex = index">{{ item }}</button>
          </div>
          <ol class="log">
            <li v-for="(entry, index) in entries" :key="index" :data-status="entry.status">
              <span class="who">{{ t.demo.actor[task.actor] }}</span>
              <b>{{ t.demo.tools[entry.step.tool] }}</b><code>{{ entry.step.target }}</code>
              <em>{{ t.demo.status[entry.status] }}</em>
            </li>
          </ol>
          <div v-if="pending" class="approval">
            <p class="eyebrow">{{ t.demo.asking }} · {{ t.demo.actor[task.actor] }}</p>
            <h3>{{ t.demo.tools[pending.step.tool] }} <code>{{ pending.step.target }}</code></h3>
            <div><button @click="decide(false)">{{ t.demo.deny }}</button><button class="primary" @click="decide(true)">{{ t.demo.approve }}</button></div>
          </div>
          <div v-if="finished && changes.length" class="delivery" :class="{ undone }">
            <p class="eyebrow">{{ t.demo.delivery }}</p>
            <div v-for="change in changes" :key="change.path" class="change"><span :class="change.status">{{ change.status === 'added' ? t.demo.added : t.demo.modified }}</span><code>{{ change.path }}</code><small>{{ change.stat }}</small></div>
            <button :disabled="undone" @click="undo">{{ undone ? '✓' : t.demo.undo }}</button>
          </div>
          <div class="demo-actions">
            <button class="button primary" :disabled="running" @click="start">{{ running ? t.demo.busy : finished ? t.demo.again : t.demo.start }} <span>↗</span></button>
          </div>
          <p class="fine">{{ t.demo.disclosure }}</p>
          <p class="fine">{{ t.demo.online.text }} <a :href="studio" target="_blank" rel="noopener">{{ t.demo.online.link }} ↗</a></p>
        </div>
      </div>
    </section>

    <section id="features" class="features wrap">
      <article v-for="(item, index) in t.showcase" :key="item.eyebrow" class="showcase" :class="{ flip: index % 2 === 1 }">
        <div class="showcase-copy">
          <p class="eyebrow">{{ item.eyebrow }}</p>
          <h2>{{ item.title }}</h2>
          <p>{{ item.body }}</p>
          <ul><li v-for="point in item.points" :key="point">{{ point }}</li></ul>
        </div>
        <img :src="item.image" :alt="item.alt" loading="lazy" width="1600" height="965">
      </article>
      <div class="grid">
        <article v-for="item in t.grid" :key="item.title"><span>{{ item.icon }}</span><h3>{{ item.title }}</h3><p>{{ item.body }}</p></article>
      </div>
    </section>

    <section id="modes" class="modes wrap">
      <div class="heading">
        <div><p class="eyebrow">{{ t.modesSection.eyebrow }}</p><h2>{{ t.modesSection.title[0] }}<br><em>{{ t.modesSection.title[1] }}</em></h2></div>
        <p>{{ t.modesSection.desc }}</p>
      </div>
      <div class="mode-cards">
        <article v-for="item in modeOrder" :key="item" :data-mode="item">
          <header><i class="mode-dot" :class="item" /><h3>{{ modes[item].name[lang] }}</h3><small>{{ modes[item].hint[lang] }}</small></header>
          <p class="stance">{{ modes[item].stance[lang] }}</p>
          <dl>
            <template v-for="(row, index) in t.modesSection.rows" :key="row"><dt>{{ row }}</dt><dd>{{ modes[item].cells[index]![lang] }}</dd></template>
          </dl>
          <a href="#demo" @click="mode = item">{{ t.modesSection.try }} →</a>
        </article>
      </div>
      <p class="always">🔒 {{ t.modesSection.always }} <code>Bash(pnpm test:*)</code><code>Edit(src/**)</code><code>Network(*.github.com)</code></p>
    </section>

    <section class="journey wrap">
      <p class="eyebrow">{{ t.journey.eyebrow }}</p>
      <h2>{{ t.journey.title }}</h2>
      <ol>
        <li v-for="item in t.journey.items" :key="item.name"><span>{{ item.tag }}</span><h3>{{ item.name }}</h3><p>{{ item.text }}</p></li>
      </ol>
    </section>

    <section id="download" class="download wrap">
      <div class="download-main">
        <p class="eyebrow">{{ t.download.eyebrow }}</p>
        <h2>{{ t.download.title[0] }}<br><em>{{ t.download.title[1] }}</em></h2>
        <div class="os-tabs" role="tablist">
          <button v-for="item in (['mac', 'linux', 'win'] as const)" :key="item" role="tab" :aria-selected="os === item" @click="os = item">{{ osNames[item] }}</button>
        </div>
        <div class="installer">
          <a class="button primary" :href="installers[os]">{{ t.download.button(osNames[os]) }} <span>↓</span></a>
          <span class="label">{{ t.download.file[os] }}</span>
        </div>
        <p class="first-open">{{ t.download.open[os] }}</p>
        <ol class="steps"><li v-for="step in t.download.steps" :key="step">{{ step }}</li></ol>
        <p class="label cli-label">{{ t.download.cli }} {{ t.download.hint[os] }}</p>
        <div class="command"><code>{{ commands[os] }}</code><button @click="copyCommand(commands[os])">{{ copied === commands[os] ? t.download.copied : t.download.copy }}</button></div>
        <p class="fine">{{ t.download.note }}</p>
        <div class="links">
          <a :href="repo" target="_blank" rel="noopener">{{ t.download.links.source }} ↗</a>
          <a :href="`${repo}/releases/latest`" target="_blank" rel="noopener">{{ t.download.links.releases }} ↗</a>
          <a :href="`${repo}/blob/main/website/public/${os === 'win' ? 'install.ps1' : 'install.sh'}`" target="_blank" rel="noopener">{{ t.download.links.script }} ↗</a>
        </div>
      </div>
      <aside class="coffee">
        <span class="cup">☕</span>
        <p class="eyebrow">{{ t.coffee.eyebrow }}</p>
        <h3>{{ t.coffee.title[0] }}<br>{{ t.coffee.title[1] }}</h3>
        <p>{{ t.coffee.body }}</p>
        <button class="button" @click="support?.showModal()">{{ t.coffee.button }} <span>♡</span></button>
        <small>{{ t.coffee.small }}</small>
      </aside>
    </section>
  </main>

  <footer class="footer wrap">
    <a class="wordmark" href="#">anna</a>
    <p>{{ t.footer.tagline }}<span>{{ t.footer.license }} © {{ year }}</span></p>
    <a :href="repo" target="_blank" rel="noopener">GitHub ↗</a>
  </footer>

  <dialog ref="support" class="support-dialog">
    <div class="support-heading"><div><p class="eyebrow">{{ t.dialog.eyebrow }}</p><h2>{{ t.dialog.title }}</h2></div><button :aria-label="t.dialog.close" @click="support?.close()">×</button></div>
    <p>{{ t.dialog.body }}</p>
    <div class="payment-tabs"><button :aria-pressed="payment === 'wechat'" @click="payment = 'wechat'">{{ t.dialog.wechat }}</button><button :aria-pressed="payment === 'alipay'" @click="payment = 'alipay'">{{ t.dialog.alipay }}</button></div>
    <img class="payment-image" :src="`/media/${payment}.webp`" :alt="payment === 'wechat' ? t.dialog.wechat : t.dialog.alipay">
    <p>{{ t.dialog.scan(payment === 'wechat' ? t.dialog.wechat : t.dialog.alipay) }}</p>
    <a class="text-link" :href="`/media/${payment}.webp`" :download="`Anna-${payment}.webp`">{{ t.dialog.save }}</a>
  </dialog>
</template>
