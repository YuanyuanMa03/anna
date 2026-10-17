<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import CharacterStage from '../../apps/desktop/src/character-stage.vue'
import { characters } from '../../packages/character/manifest'

const scenes = [
  { id: 'daily', label: '聊聊日常', icon: '✧', title: '今天，也给自己一点空间。', prompt: '今天有点累，感觉好多事情都没做好。', response: '那先坐一会儿吧。累的时候，没必要急着给今天打分。\n\n我们先找一件已经完成的小事，好吗？哪怕只是按时吃了饭，也算认真照顾了自己。剩下的事，我们一件一件来。', action: '和她说说今天', receipt: '日常陪伴 · 认真听，也有自己的想法' },
  { id: 'work', label: '整理工作', icon: '▤', title: '把一团思绪，变成下一步。', prompt: '明天要交方案，还要改官网、整理会议记录。我不知道从哪里开始。', response: '先把最接近截止时间的方案放在前面。\n\n① 今天：列出方案提纲，圈出需要补齐的资料。\n② 明早：完成初稿，再留半小时检查。\n③ 之后：把会议记录里的行动项，整理成官网修改清单。\n\n在桌面端选择工作文件夹，我可以帮你读文件、写清单，一起把计划落实。', action: '一起理清工作', receipt: '桌面端工作模式 · 读取文件 → 整理 → 写入结果' },
  { id: 'code', label: '一起写代码', icon: '⌘', title: '遇到难题，一起找出原因。', prompt: '我的待办列表点击“完成”后，页面却没有更新。该怎么查？', response: '先确认：点击事件有没有触发，任务状态有没有更新，页面有没有用到这份状态。\n\n如果你用 Vue，可以从响应式状态开始检查。比如：\nconst done = ref(false)\ndone.value = !done.value\n\n在桌面端选择项目文件夹后，我可以读取代码、修改文件，再运行项目已有的检查。执行结果会显示在工具活动中。', action: '一起排查问题', receipt: '桌面端开发工具 · 文件读写 / 终端 / 单次授权' },
]
const selected = ref(0)
const scene = computed(() => scenes[selected.value])
const characterIndex = ref(0)
const character = computed(() => characters[characterIndex.value])
const started = ref(false)
const replying = ref(false)
const showReply = ref(false)
const speaking = ref(false)
const voiceEnabled = ref(false)
const voiceStatus = ref('')
const support = ref<HTMLDialogElement>()
const payment = ref<'wechat' | 'alipay'>('wechat')
let timer: ReturnType<typeof setTimeout> | undefined
function stopVoice() {
  if ('speechSynthesis' in window)
    speechSynthesis.cancel(); speaking.value = false
}
function reset() { clearTimeout(timer); stopVoice(); started.value = false; replying.value = false; showReply.value = false; voiceStatus.value = '' }
function choose(index: number) { reset(); selected.value = index }
function speak() {
  stopVoice()
  if (!('speechSynthesis' in window)) { voiceStatus.value = '当前浏览器不支持朗读，可以直接阅读对话。'; return }
  const utterance = new SpeechSynthesisUtterance(scene.value.response)
  utterance.lang = 'zh-CN'
  utterance.rate = 0.95
  const voice = speechSynthesis.getVoices().find(item => item.lang.startsWith('zh'))
  if (voice)
    utterance.voice = voice
  utterance.onstart = () => { speaking.value = true; voiceStatus.value = '正在朗读预设回复' }
  utterance.onend = () => { speaking.value = false; voiceStatus.value = '' }
  utterance.onerror = () => { speaking.value = false; voiceStatus.value = '朗读未完成。请检查设备声音或浏览器语音支持。' }
  speechSynthesis.speak(utterance)
}
function play() {
  reset(); started.value = true; replying.value = true
  timer = setTimeout(() => {
    replying.value = false; showReply.value = true; if (voiceEnabled.value)
      speak()
  }, 850)
}
onBeforeUnmount(reset)
</script>

<template>
  <header class="nav"><a href="#" class="wordmark" aria-label="Anna 首页">Anna<span>你的桌面 AI 伙伴</span></a><nav aria-label="主导航"><a href="#experience">试试 Anna</a><a href="#abilities">她能做什么</a><a href="#download">下载</a></nav><button class="support-link" @click="support?.showModal()">请她喝杯咖啡 <span>↗</span></button></header>
  <main>
    <section class="hero section-width"><div class="hero-copy"><p class="eyebrow"><span class="live-dot" /> A LITTLE COMPANY. A LOT OF POSSIBILITY.</p><h1>陪你聊，<br>也陪你把<br><em>事情做好。</em></h1><p class="hero-description">有温度的 AI 伙伴，也是能读文件、写代码、推进工作的桌面助手。<br>让一个人的日常，多一个认真回应。</p><div class="hero-actions"><a class="button primary" href="#experience">试试 Anna <span>↗</span></a><a class="button secondary" href="#download">下载桌面版 <span>↓</span></a></div><p class="platforms">macOS · Windows <span>自己的模型，自己的工作空间</span></p></div><div class="product-hero"><div class="product-frame"><div class="window-bar"><span class="traffic"><i /><i /><i /></span><span>Anna · 桌面应用实拍</span><span class="frame-star">✧</span></div><img class="product-screenshot" src="/media/anna-desktop.webp" alt="Anna 实际桌面界面：左侧 Live2D 角色，右侧对话、模型设置和工具活动" fetchpriority="high" width="1280" height="860"></div><div class="floating-note"><span>✦</span><div><strong>不止停留在对话框里</strong><small>陪伴 · 文件 · 代码 · 微信连接</small></div></div><div class="hero-small-note">MEET ANNA, MAKE ROOM FOR POSSIBILITY.</div></div></section>
    <div class="intro-strip section-width"><span>一个 Anna，多一点可能。</span><p>会动的角色 <b>／</b> 真实的工具 <b>／</b> 由你掌握的工作空间</p></div>
    <section id="experience" class="experience section-width"><div class="section-heading"><div><p class="eyebrow">A MOMENT WITH ANNA</p><h2>先打个招呼，<em>再慢慢熟悉。</em></h2></div><p>不用下载，先感受一下和 Anna 相处。<br>点击角色、移动鼠标，也可以打开语音朗读。</p></div><div class="demo-shell"><div class="demo-stage"><div class="stage-label"><span class="live-dot" /> LIVE2D · 真实角色渲染</div><div class="model-area"><CharacterStage :character="character" :speaking="speaking" /></div><div class="character-picker" aria-label="选择演示角色"><button v-for="(item, index) in characters" :key="item.id" :aria-pressed="characterIndex === index" @click="characterIndex = index"><img :src="item.thumbnailPath" :alt="item.name"><span>{{ item.name }}</span></button></div><p class="stage-note">移动鼠标看看她 · 点击角色互动</p></div><div class="demo-conversation"><div class="scene-tabs" role="tablist" aria-label="演示场景"><button v-for="(item, index) in scenes" :id="`tab-${item.id}`" :key="item.id" role="tab" :aria-selected="selected === index" aria-controls="scene-panel" @click="choose(index)"><span>{{ item.icon }}</span>{{ item.label }}</button></div><div id="scene-panel" class="scene-panel" role="tabpanel" :aria-labelledby="`tab-${scene.id}`"><p class="demo-disclosure">预设剧情演示 · 不连接真实模型</p><h3>{{ scene.title }}</h3><div class="demo-messages" aria-live="polite"><div class="bubble anna"><span>Anna</span><p>嗨，我是 Anna。<br>今天想一起做点什么？</p></div><div v-if="started" class="bubble you"><span>你</span><p>{{ scene.prompt }}</p></div><div v-if="replying" class="typing" role="status">Anna 正在回应 <span>···</span></div><div v-if="showReply" class="bubble anna response"><span>Anna</span><p>{{ scene.response }}</p></div><button v-if="!started" class="prompt-button" @click="play">{{ scene.prompt }} <span>↗</span></button></div><p v-if="showReply" class="demo-receipt">✓ {{ scene.receipt }}</p></div><div class="demo-controls"><button class="button primary" @click="play">{{ started ? '再体验一次' : scene.action }} <span>↗</span></button><label><input v-model="voiceEnabled" type="checkbox">语音朗读</label><button v-if="showReply" class="voice-button" @click="speaking ? stopVoice() : speak()">{{ speaking ? '停止朗读' : '朗读回复' }}</button></div><p v-if="voiceStatus" class="voice-status" role="status">{{ voiceStatus }}</p><p class="demo-footnote">对话是预先编写的示例。真实问答与文件操作，请下载桌面端并连接模型。声音由浏览器提供。</p></div></div></section>
    <section id="abilities" class="abilities section-width">
      <div class="section-heading"><div><p class="eyebrow">COMPANY, WITH CAPABILITY</p><h2>有回应，<em>也有行动。</em></h2></div><p>从一句“你好”，到一份完成的工作。<br>你提出想法，Anna 和你一起往前走。</p></div><div class="ability-grid">
        <article class="ability-card"><span class="ability-icon">▤</span><h3>把工作，理出头绪</h3><p>选择一个文件夹，让 Anna 读取文本、整理任务、写出结果。过程与文件，都留在你的工作区。</p><div class="file-visual"><div><span class="file-icon">TXT</span> 会议记录.txt <small>读取</small></div><span class="flow-arrow">↓</span><div><span class="file-icon purple">MD</span> 下一步行动.md <small>写入</small></div><p>每一步都有实际工具活动可查看</p></div></article><article class="ability-card">
          <span class="ability-icon">⌘</span><h3>把问题，一起解决</h3><p>阅读项目代码、编辑文件、运行终端命令。基于 DeepSeek Harness，把开发任务带进同一个对话。</p><div class="code-visual">
            <div><i /><span>一个小小的开始</span></div><pre>// 和 Anna 一起，往前一步
const nextStep = {
  read: '理解项目',
  build: '完成修改',
  check: '验证结果'
}</pre><small>工具请求超出当前权限时，单独确认</small>
          </div>
        </article><article class="ability-card"><span class="ability-icon green">◉</span><h3>在微信里，继续聊</h3><p>桌面端打开微信连接，扫描 ClawBot 二维码。只响应绑定账号，沿用 Anna 的模型和工作区。</p><div class="wechat-visual"><div class="mini-message">Anna，帮我理一下今天的任务。</div><div class="mini-message reply">我在。我们从最重要的一件开始。</div><p><span class="live-dot" /> 扫码入口在桌面端</p><small>需账号开放 ClawBot，Anna 保持运行<br>工具授权在桌面确认</small></div></article>
      </div>
    </section>
    <section class="steps section-width"><p class="eyebrow">YOUR SPACE, YOUR PACE</p><h2>让 Anna 来到你的桌面。</h2><div><article><b>01</b><h3>下载，打开 Anna</h3><p>挑选喜欢的角色，给桌面多一点生气。</p></article><article><b>02</b><h3>连接你的模型</h3><p>填写服务商地址与 API Key，开始真实对话。模型费用由服务商收取。</p></article><article><b>03</b><h3>选一个工作文件夹</h3><p>需要她动手时开启工作模式。想轻松聊聊，也随时可以切回陪伴。</p></article></div></section>
    <section id="download" class="download section-width"><div class="download-main"><p class="eyebrow">MAKE YOURSELF AT HOME</p><h2>下一次打开电脑，<br><em>有 Anna 在。</em></h2><p>桌面预览版 · 免费下载 · 连接自己的模型</p><div class="install-commands"><p class="install-label">macOS / Linux：在终端运行</p><pre class="install-command"><code>curl -fsSL https://anna.mayuanyuan.top/install.sh | bash</code></pre><p class="install-label">Windows：在 PowerShell 运行</p><pre class="install-command"><code>irm https://anna.mayuanyuan.top/install.ps1 | iex</code></pre></div><p class="download-note">一行命令会下载最新版本、校验 SHA-256 并安装，不会出现“无法验证开发者”的拦截；之后 Anna 会在应用内自动更新。Anna 没有经过 Apple 公证；代码和安装脚本都是开源的，可以先打开看看再运行。</p><a class="text-link" href="https://github.com/YuanyuanMa03/anna">开源代码、版本记录与校验文件 ↗</a></div><aside class="coffee-card"><span class="coffee-art">☕</span><p class="eyebrow">A LITTLE THANK YOU</p><h3>坐下来，<br>喝杯咖啡吧。</h3><p>如果 Anna 给你带来了一点陪伴，<br>欢迎请开发者喝一杯咖啡。<br>每一份心意，都是继续创造的动力。</p><button class="button secondary" @click="support?.showModal()">支持 Anna <span>♡</span></button><small>微信 / 支付宝 · 完全自愿</small></aside></section>
  </main><footer class="footer section-width"><a class="wordmark" href="#">Anna</a><p>认真陪伴，一起完成。<span>© {{ new Date().getFullYear() }} Anna</span></p><a href="#experience">再和 Anna 待一会儿 ↗</a></footer>
  <dialog ref="support" class="support-dialog"><div class="support-heading"><div><p class="eyebrow">THANK YOU FOR BEING HERE</p><h2>请开发者喝杯咖啡</h2></div><button aria-label="关闭打赏弹窗" @click="support?.close()">×</button></div><p>打赏完全自愿，金额由你决定。谢谢你的心意。</p><div class="payment-tabs"><button :aria-pressed="payment === 'wechat'" @click="payment = 'wechat'">微信支付</button><button :aria-pressed="payment === 'alipay'" @click="payment = 'alipay'">支付宝</button></div><img class="payment-image" :src="`/media/${payment}.webp`" :alt="`${payment === 'wechat' ? '微信' : '支付宝'}打赏收款二维码`"><p>使用{{ payment === 'wechat' ? '微信' : '支付宝' }}扫一扫，或保存图片后识别。</p><a class="text-link" :href="`/media/${payment}.webp`" :download="`Anna-${payment}.webp`">保存完整收款码 ↓</a></dialog>
</template>
