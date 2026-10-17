<script setup lang="ts">
import type { ApprovalQuestion, ApprovalScope } from '../../../../packages/shared/contracts'

defineProps<{ approval: ApprovalQuestion }>()
const emit = defineEmits<{ decide: [allow: boolean, scope: ApprovalScope] }>()
const toolNames: Record<string, string> = { bash: '终端命令', powershell: '终端命令', write: '写文件', edit: '修改文件', read: '读取', network: '联网' }
</script>

<template>
  <div class="card approval-request" role="alert" :class="{ danger: approval.danger }">
    <span class="eyebrow">{{ approval.origin === 'weixin' ? '来自微信任务 · ' : '' }}{{ toolNames[approval.toolName] ?? approval.toolName }} · 需要你确认</span>
    <strong>{{ approval.reason }}</strong>
    <pre>{{ approval.details }}</pre>
    <p v-if="approval.danger" class="small warn">这个操作可能难以撤销，只能逐次批准。</p>
    <p v-else-if="approval.rule" class="small muted">“总是允许”会为这个工作文件夹记下规则 <code>{{ approval.rule }}</code>，可以在“外观与能力”里删除。</p>
    <div class="card-actions">
      <button @click="emit('decide', false, 'once')">拒绝</button>
      <template v-if="!approval.danger && approval.rule">
        <button @click="emit('decide', true, 'always')">总是允许</button>
        <button @click="emit('decide', true, 'session')">本次会话都允许</button>
      </template>
      <button class="primary" @click="emit('decide', true, 'once')">仅允许一次</button>
    </div>
  </div>
</template>
