<script setup lang="ts">
import type { TaskResult } from '../../../../packages/shared/contracts'
import { ref } from 'vue'

const props = defineProps<{ result: TaskResult, error?: string }>()
const emit = defineEmits<{ changes: [], undo: [force: boolean] }>()
const confirming = ref(false)
const statusLabels = { added: '新增', modified: '修改', deleted: '删除' }
function undo() {
  if (!confirming.value) {
    confirming.value = true
    return
  }
  confirming.value = false
  emit('undo', Boolean(props.error?.includes('又被改过')))
}
</script>

<template>
  <div class="card result-card" :class="{ failed: !result.ok && result.status !== 'aborted', aborted: result.status === 'aborted' }">
    <span class="eyebrow">{{ result.undone ? '已撤销' : result.status === 'aborted' ? '已停下' : result.ok ? '交付' : '还没完成' }}{{ result.origin === 'weixin' ? ' · 微信任务' : '' }}</span>
    <ul class="changes">
      <li v-for="change in result.changes.slice(0, 8)" :key="change.path" :data-status="change.status">
        <span class="badge">{{ statusLabels[change.status] }}</span><code>{{ change.path }}</code><small><b class="plus">+{{ change.added }}</b> <b class="minus">−{{ change.removed }}</b></small>
      </li>
    </ul>
    <ul>
      <li v-if="result.elapsedMs !== undefined">耗时 {{ (result.elapsedMs / 1000).toFixed(1) }} 秒 · {{ result.toolCalls ?? 0 }} 次工具调用</li>
      <li v-if="result.usage">Token{{ result.usage.partial ? '（部分统计）' : '' }}：输入 {{ result.usage.input ?? '未知' }} · 输出 {{ result.usage.output ?? '未知' }} · 缓存读取 {{ result.usage.cacheRead ?? '未知' }} · 缓存写入 {{ result.usage.cacheWrite ?? '未知' }}</li>
      <li v-else class="muted">本次 token 用量：大脑未报告</li>
      <li v-if="result.tests">验证：{{ result.tests === 'passed' ? '通过 ✓' : '未通过 ✗' }}</li>
      <li v-if="result.commands">运行了 {{ result.commands }} 条命令<span v-if="result.changes.length" class="muted">（命令造成的改动不在撤销范围内）</span></li>
      <li v-if="result.failedTools">{{ result.failedTools }} 个步骤失败或被拒绝</li>
      <li v-if="!result.changes.length && !result.commands">这一轮只是对话，没有动文件。</li>
    </ul>
    <div v-if="result.changes.length && !result.undone" class="card-actions">
      <button @click="emit('changes')">查看改动</button>
      <button :class="{ primary: confirming }" @click="undo">{{ confirming ? (error?.includes('又被改过') ? '仍然撤销' : '确认撤销') : '撤销这次改动' }}</button>
    </div>
  </div>
</template>
