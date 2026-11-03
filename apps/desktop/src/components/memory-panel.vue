<script setup lang="ts">
import type { Command, MemoryDraft, MemoryItem, RuntimeSnapshot } from '../../../../packages/shared/contracts'
import { reactive, ref } from 'vue'

defineProps<{ snapshot: RuntimeSnapshot, busy: boolean }>()
const emit = defineEmits<{ command: [command: Command] }>()
const editing = ref('')
const draft = reactive<MemoryDraft>({ text: '', kind: 'preference' })
const kinds = { preference: '偏好', agreement: '约定', experience: '共同经历' }
function edit(item: MemoryItem) {
  editing.value = item.id
  Object.assign(draft, { text: item.text, kind: item.kind ?? 'preference' })
}
</script>

<template>
  <h3>共同记忆</h3>
  <p class="small muted">你明确要求记住的内容直接保存；Anna 主动提议的内容由你确认。每条都可查看、修改和删除。修改、删除或关闭记忆后会开始新会话，避免继续使用旧上下文；工作记录保留。</p>
  <button :disabled="busy" :aria-pressed="snapshot.settings.memoryEnabled" @click="emit('command', { type: 'memory', enabled: !snapshot.settings.memoryEnabled })">{{ snapshot.settings.memoryEnabled ? '关闭记忆' : '开启记忆' }}</button>
  <p v-if="!snapshot.memories.length" class="muted">还没有记忆，可以告诉 Anna“记住：……”</p>
  <article v-for="item in snapshot.memories" :key="item.id" class="card">
    <template v-if="editing === item.id"><label>记忆内容<textarea v-model="draft.text" maxlength="300" /></label><label>分类<select v-model="draft.kind" aria-label="记忆分类"><option v-for="(name, kind) in kinds" :key="kind" :value="kind">{{ name }}</option></select></label><button :disabled="busy || !draft.text.trim()" @click="emit('command', { type: 'memory-update', id: item.id, memory: { ...draft } }); editing = ''">保存修改</button><button @click="editing = ''">取消</button></template>
    <template v-else><p>{{ item.text }}</p><p class="small muted">{{ kinds[item.kind ?? 'preference'] }} · {{ item.by ?? '未记录来源' }} · {{ new Date(item.updatedAt ?? item.createdAt).toLocaleString('zh-CN') }}{{ item.updatedAt ? '（用户已修改）' : '' }}</p><div class="card-actions"><button :disabled="busy" @click="edit(item)">修改记忆</button><button :disabled="busy" @click="emit('command', { type: 'memory-forget', id: item.id })">忘记</button></div></template>
  </article>
</template>
