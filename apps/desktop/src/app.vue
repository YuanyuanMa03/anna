<script setup lang="ts">
import type { Command, RuntimeSnapshot } from '../../../packages/shared/contracts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { characters } from '../../../packages/character/manifest'
import CharacterStage from './character-stage.vue'
import SettingsPanel from './settings-panel.vue'

const snapshot = ref<RuntimeSnapshot>()
const settingsOpen = ref(false)
const pluginsOpen = ref(false)
const busy = ref(false)
const error = ref('')
const input = ref('')
const activity = ref('')
const turnCompleted = ref(false)
const tools = ref<{ name: string, phase: string, text: string }[]>([])
const autoSpeak = ref(false)
const speaking = ref(false)
const chat = ref<HTMLDivElement>()
const character = computed(() => characters.find(c => c.id === snapshot.value?.settings.characterId) ?? characters[0])
const blocked = computed(() => busy.value || snapshot.value?.state === 'running' || snapshot.value?.state === 'starting')
let release: (() => void) | undefined
async function scroll() { await nextTick(); chat.value?.scrollTo({ top: chat.value.scrollHeight, behavior: 'smooth' }) }
async function run(command: Command) {
  if (command.type !== 'character')
    busy.value = true
  error.value = ''
  if (command.type === 'send') { tools.value = []; turnCompleted.value = false }
  try {
    const result = await window.anna.invoke(command)
    if (!result.ok) { error.value = result.error; return }
    snapshot.value = result.snapshot
    if (command.type === 'send' && result.snapshot.state === 'ready')
      turnCompleted.value = true
    if (command.type === 'configure')
      activity.value = '配置已保存。发送消息以验证真实连接。'
    if (command.type === 'send' && autoSpeak.value) {
      const text = result.snapshot.messages.at(-1)?.text
      if (text) {
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.lang = 'zh-CN'
        utterance.onstart = () => { speaking.value = true }
        utterance.onend = utterance.onerror = () => { speaking.value = false }
        speechSynthesis.speak(utterance)
      }
    }
    await scroll()
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally {
    busy.value = false; if (command.type === 'send')
      activity.value = ''
  }
}
function send() {
  const text = input.value.trim()
  if (!text || blocked.value)
    return
  input.value = ''
  tools.value = []
  void run({ type: 'send', text })
}
onMounted(async () => {
  release = window.anna.subscribe((event) => {
    if (event.type === 'navigate')
      settingsOpen.value = true
    if (event.type === 'snapshot')
      snapshot.value = event.snapshot
    if (event.type === 'tool')
      tools.value.push(event)
    if (event.type === 'activity')
      activity.value = event.text
    void scroll()
  })
  await run({ type: 'snapshot' })
  if (snapshot.value?.hasKey)
    await run({ type: 'connect' })
})
onBeforeUnmount(() => { release?.(); speechSynthesis.cancel() })
</script>

<template>
  <main v-if="snapshot" class="app-shell">
    <header class="topbar"><div class="brand">anna<span>REBORN</span></div><span class="tagline">A Composable Digital Life</span><div class="header-actions"><span class="connection"><i :class="{ online: snapshot.state === 'ready' || snapshot.state === 'running' }" />{{ snapshot.state === 'ready' ? '已连接' : snapshot.state === 'running' ? '思考中' : snapshot.state === 'starting' ? '正在连接' : '等待连接' }} · {{ snapshot.settings.model.model }}</span><button @click="pluginsOpen = true">插件</button><button @click="settingsOpen = true">模型与设置</button></div></header>
    <div class="main-layout">
      <section class="companion" aria-label="Anna 角色舞台">
        <div class="stage-caption"><span class="eyebrow">HERE WITH YOU</span><h1>很高兴，与你相遇。</h1><p>一个 Anna，三种模样。让陪伴慢慢生长。</p></div>
        <div class="stage"><div class="stage-halo" /><CharacterStage :character="character" :speaking="speaking" /></div>
        <div class="stage-name"><span class="presence-dot" />{{ character.name }}<span>{{ character.label }} · Live2D</span></div>
        <div class="character-cards" role="group" aria-label="选择角色">
          <button v-for="item in characters" :key="item.id" :aria-label="`选择 ${item.name}`" :aria-pressed="character.id === item.id" class="character-card" :class="[{ selected: character.id === item.id }]" @click="run({ type: 'character', id: item.id })"><img :src="item.thumbnailPath" :alt="item.label"><span><strong>{{ item.name }}</strong><small>{{ item.label }}</small></span><span v-if="character.id === item.id" class="selected-dot" /></button>
        </div>
      </section>
      <section class="conversation" aria-label="与 Anna 对话">
        <div class="conversation-heading"><div><span class="eyebrow">A LITTLE CLOSER</span><h2>和 Anna 聊聊</h2></div><span class="brain-label">DSH BRAIN</span></div>
        <div ref="chat" class="messages" aria-live="polite">
          <div v-if="!snapshot.messages.length" class="empty-chat"><div class="anna-orb">a</div><h3>我在这里，认真听你说。</h3><p>分享今天的小事，或一起理清一个想法。<br>从一句“你好”开始。</p><button :disabled="blocked" @click="run({ type: 'send', text: 'Anna，你好，介绍一下你自己。' })">Anna，你好，介绍一下你自己。</button></div>
          <article v-for="(message, index) in snapshot.messages" :key="index" class="message" :class="[message.role]"><span>{{ message.role === 'user' ? '你' : 'Anna' }}</span><p>{{ message.text }}</p></article>
          <p v-if="activity" class="activity" role="status">{{ activity }}</p>
          <p v-if="turnCompleted && !tools.length" class="activity">本轮没有实际工具调用</p>
          <details v-if="tools.length" class="tool-events"><summary>工具活动 · {{ tools.length }} 个事件</summary><div v-for="(tool, index) in tools" :key="index"><strong>{{ tool.name }} · {{ tool.phase === 'call' ? '发起调用' : '返回结果' }}</strong><pre>{{ tool.text }}</pre></div></details>
        </div>
        <div v-if="error || snapshot.error" class="error" role="alert">{{ error || snapshot.error }}</div>
        <div v-if="!snapshot.hasKey" class="setup-notice"><span>为 Anna 连接一个真实模型，开始第一次对话。</span><button @click="settingsOpen = true">配置模型</button></div>
        <form class="composer" @submit.prevent="send"><textarea v-model="input" aria-label="消息" placeholder="想对 Anna 说些什么？" :disabled="blocked" @keydown.enter.exact.prevent="send" /><div class="composer-actions"><label><input v-model="autoSpeak" type="checkbox">朗读回复</label><button v-if="blocked" type="button" @click="run({ type: 'stop' })">关闭运行时以中断</button><button class="primary" :disabled="blocked || !input.trim() || !snapshot.hasKey" type="submit">发送 ↗</button></div></form>
        <p class="conversation-footnote">{{ snapshot.restored ? '会话已恢复' : '同一个 Anna 大脑' }} · 外观切换不改变对话</p>
      </section>
    </div>
    <footer><span>ANNA / DIGITAL LIFE, IN PROGRESS</span><span>本地运行 · 按需组合 · 真诚相伴</span></footer>
    <SettingsPanel v-if="settingsOpen" :snapshot="snapshot" :busy="blocked" @close="settingsOpen = false" @command="run" />
    <div v-if="pluginsOpen" class="sheet-backdrop" @click.self="pluginsOpen = false"><section class="sheet" role="dialog" aria-modal="true" aria-label="Anna 插件"><div class="sheet-heading"><div><span class="eyebrow">COMPOSABLE SOUL</span><h2>让能力慢慢生长</h2></div><button class="icon-button" aria-label="关闭插件" @click="pluginsOpen = false">×</button></div><p class="muted">只加载随 Anna 提供的本地插件。切换能力会关闭并重新组合 DSH，然后恢复会话。</p><div class="plugin-row"><div><h3>Anna Persona <small>1.0.0</small></h3><p>善良、理性、真诚，拥有自己的观点。</p><span>{{ snapshot.plugins.includes('anna-persona') ? '实际已加载' : '尚未加载' }}</span></div><span>基础人格</span></div><div class="plugin-row"><div><h3>Anna Status <small>1.0.0</small></h3><p>读取当前角色、版本与已加载插件。</p><span>{{ snapshot.plugins.includes('anna-status') ? '实际已加载' : '未加载' }}</span></div><button :disabled="blocked || !snapshot.hasKey" :aria-pressed="snapshot.settings.statusEnabled" @click="run({ type: 'plugin', enabled: !snapshot.settings.statusEnabled })">{{ snapshot.settings.statusEnabled ? '禁用状态工具' : '启用状态工具' }}</button></div><p class="muted small">实际工具注册表：{{ snapshot.tools.join('、') || '无' }}<br>运行时：{{ snapshot.state }}</p><button :disabled="blocked || !snapshot.tools.includes('anna_status')" @click="pluginsOpen = false; run({ type: 'send', text: 'Anna，调用你的状态工具，检查你现在加载了什么插件。' })">请 Anna 检查运行状态</button><p v-if="error" class="error">{{ error }}</p></section></div>
  </main>
  <main v-else class="boot">Anna 正在醒来…<p v-if="error">{{ error }}</p></main>
</template>
