<script setup lang="ts">
import type { Command, MemoryDraft, MemoryItem, RuntimeSnapshot } from '../../../../packages/shared/contracts'
import { computed, reactive, ref } from 'vue'

const props = defineProps<{ snapshot: RuntimeSnapshot, busy: boolean }>()
const emit = defineEmits<{ command: [command: Command] }>()
const editing = ref('')
const draft = reactive<MemoryDraft>({ text: '', kind: 'preference' })
const kinds = { preference: '偏好', agreement: '约定', experience: '共同经历' }
const together = computed(() => props.snapshot.relationship)
/** What she knows about you, by kind; the newest first in each group. */
const portrait = computed(() => (['preference', 'agreement', 'experience'] as const).map((kind) => {
  const all = props.snapshot.memories.filter(item => (item.kind ?? 'preference') === kind).toReversed()
  return { kind, name: kinds[kind], items: all.slice(0, 8), more: Math.max(0, all.length - 8) }
}).filter(group => group.items.length))
const purposes: Record<string, string> = { work: '工作与创作', study: '学习与探索', company: '聊天与日常陪伴' }
const purpose = computed(() => purposes[props.snapshot.settings.personality?.purpose ?? ''])
const when = (at: string) => new Date(at).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
function edit(item: MemoryItem) {
  editing.value = item.id
  Object.assign(draft, { text: item.text, kind: item.kind ?? 'preference' })
}
</script>

<template>
  <section class="together" aria-label="我们的关系">
    <h3>我们</h3>
    <div v-if="together?.since" class="vital-grid together-stats">
      <article><small>认识</small><strong>第 {{ together.days }} 天</strong><span class="small muted">从 {{ when(together.since) }} 的第一条记录算起</span></article>
      <article><small>一起完成</small><strong>{{ together.done }} 件事</strong></article>
      <article><small>她记得你</small><strong>{{ together.remembered }} 件事</strong></article>
      <article><small>约定</small><strong>{{ together.agreements ? `${together.agreements} 条` : '还没有约定' }}</strong></article>
    </div>
    <p v-else class="muted">我们刚认识。一起做完第一件事、或者告诉她“记住：……”之后，这里会慢慢长出你们的故事。</p>
    <div v-if="portrait.length || snapshot.settings.personality?.nickname" class="portrait" role="group" aria-labelledby="portrait-title">
      <h4 id="portrait-title">她眼中的你</h4>
      <p v-if="snapshot.settings.personality?.nickname || purpose" class="small muted">{{ snapshot.settings.personality?.nickname ? `她叫你“${snapshot.settings.personality.nickname}”。` : '' }}{{ purpose ? `你们主要一起${purpose}。` : '' }}</p>
      <p v-if="!snapshot.settings.memoryEnabled && portrait.length" class="small muted">记忆已关闭：下面是关闭前记得的，她现在不会再用到。</p>
      <div v-for="group in portrait" :key="group.kind" class="portrait-group" :data-kind="group.kind"><small>{{ group.name }}</small><span v-for="item in group.items" :key="item.id" class="memory-chip">{{ item.text }}</span><small v-if="group.more">还有 {{ group.more }} 条</small></div>
    </div>
    <h4 v-if="together?.moments.length" id="story-title">我们的故事</h4>
    <ol v-if="together?.moments.length" class="story" aria-labelledby="story-title">
      <li v-for="(moment, index) in together.moments" :key="`${moment.at}-${index}`" :data-kind="moment.kind"><time :datetime="moment.at">{{ when(moment.at) }}</time><span>{{ moment.text }}</span></li>
    </ol>
  </section>
  <h3>共同记忆</h3>
  <p class="small muted">你明确要求记住的内容直接保存；Anna 主动提议的内容由你确认。每条都可查看、修改和删除。修改、删除或关闭记忆后会开始新会话，避免继续使用旧上下文；工作记录保留。</p>
  <button :disabled="busy" :aria-pressed="snapshot.settings.memoryEnabled" @click="emit('command', { type: 'memory', enabled: !snapshot.settings.memoryEnabled })">{{ snapshot.settings.memoryEnabled ? '关闭记忆' : '开启记忆' }}</button>
  <p v-if="!snapshot.memories.length" class="muted">还没有记忆，可以告诉 Anna“记住：……”</p>
  <article v-for="item in snapshot.memories" :key="item.id" class="card">
    <template v-if="editing === item.id"><label>记忆内容<textarea v-model="draft.text" maxlength="300" /></label><label>分类<select v-model="draft.kind" aria-label="记忆分类"><option v-for="(name, kind) in kinds" :key="kind" :value="kind">{{ name }}</option></select></label><button :disabled="busy || !draft.text.trim()" @click="emit('command', { type: 'memory-update', id: item.id, memory: { ...draft } }); editing = ''">保存修改</button><button @click="editing = ''">取消</button></template>
    <template v-else><p>{{ item.text }}</p><p class="small muted">{{ kinds[item.kind ?? 'preference'] }} · {{ item.by ?? '未记录来源' }} · {{ new Date(item.updatedAt ?? item.createdAt).toLocaleString('zh-CN') }}{{ item.updatedAt ? '（用户已修改）' : '' }}</p><div class="card-actions"><button :disabled="busy" @click="edit(item)">修改记忆</button><button :disabled="busy" @click="emit('command', { type: 'memory-forget', id: item.id })">忘记</button></div></template>
  </article>
</template>
