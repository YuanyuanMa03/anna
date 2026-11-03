<script setup lang="ts">
import type { ApprovalQuestion, ApprovalScope, MemoryDraft } from '../../../../packages/shared/contracts'

import { reactive } from 'vue'

const props = defineProps<{ approval: ApprovalQuestion }>()
const emit = defineEmits<{ decide: [allow: boolean, scope: ApprovalScope, memory?: MemoryDraft] }>()
const memory = reactive<MemoryDraft>({ text: props.approval.memory?.text ?? '', kind: props.approval.memory?.kind ?? 'preference' })
const toolNames: Record<string, string> = { bash: '终端命令', powershell: '终端命令', write: '写文件', edit: '修改文件', read: '读取', network: '联网' }
</script>

<template>
  <div class="card approval-request" role="alert" :class="{ danger: approval.danger }">
    <span class="eyebrow">{{ approval.origin === 'weixin' ? '来自微信任务 · ' : '' }}{{ toolNames[approval.toolName] ?? approval.toolName }} · 需要你确认</span>
    <strong>{{ approval.reason }}</strong>
    <template v-if="approval.memory"><label>准备记住的内容<textarea v-model="memory.text" maxlength="300" /></label><label>分类<select v-model="memory.kind" aria-label="记忆分类"><option value="preference">偏好</option><option value="agreement">约定</option><option value="experience">共同经历</option></select></label><p class="small muted">可以修改后保存；忽略后不会重复提议。</p></template><pre v-else>{{ approval.details }}</pre>
    <p v-if="approval.danger" class="small warn">这个操作可能难以撤销，只能逐次批准。</p>
    <p v-else-if="approval.rule" class="small muted">“总是允许”会为这个工作文件夹记下规则 <code>{{ approval.rule }}</code>，可以在“外观与能力”里删除。</p>
    <div class="card-actions">
      <button @click="emit('decide', false, 'once')">{{ approval.memory ? '暂不记住' : '拒绝' }}</button>
      <template v-if="!approval.danger && approval.rule">
        <button @click="emit('decide', true, 'always')">总是允许</button>
        <button @click="emit('decide', true, 'session')">本次会话都允许</button>
      </template>
      <button class="primary" :disabled="Boolean(approval.memory && !memory.text.trim())" @click="emit('decide', true, 'once', approval.memory ? { ...memory } : undefined)">{{ approval.memory ? '确认记住' : '仅允许一次' }}</button>
    </div>
  </div>
</template>
