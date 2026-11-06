<script setup lang="ts">
import type { PermissionMode } from '../../../../packages/shared/contracts'
import { ref, watch } from 'vue'
import { modeInfo, modeOrder, modes } from '../../../../packages/permissions/modes'

const props = defineProps<{ mode: PermissionMode, trusted: boolean, disabled?: boolean, platform: string, sandboxed: boolean, autoAcknowledged?: boolean }>()
const emit = defineEmits<{ change: [mode: PermissionMode, acknowledge?: boolean] }>()
const available = (mode: PermissionMode) => props.trusted || !modes[mode].needsTrust
const confirming = ref(false)
watch(() => [props.trusted, props.disabled, props.autoAcknowledged], () => { confirming.value = false })
function select(mode: PermissionMode) {
  if (props.disabled || !available(mode))
    return
  if (mode === 'auto' && props.platform === 'win32' && !props.autoAcknowledged) {
    confirming.value = true
    return
  }
  confirming.value = false
  emit('change', mode)
}
function confirm() {
  if (!props.trusted || props.disabled)
    return
  confirming.value = false
  emit('change', 'auto', true)
}

/** Shift+Tab cycles through the modes the workspace allows, like Claude Code. */
function cycle() {
  const allowed = modeOrder.filter(available)
  select(allowed[(allowed.indexOf(props.mode) + 1) % allowed.length]!)
}
defineExpose({ cycle })
</script>

<template>
  <div class="mode-switch" role="radiogroup" aria-label="权限模式" :data-mode="mode">
    <button
      v-for="item in modeOrder" :key="item" type="button" role="radio" :aria-checked="mode === item" :data-mode="item"
      :disabled="disabled || !available(item)" :title="available(item) ? modeInfo(item, platform, sandboxed).description : '只能在你信任的工作文件夹里使用'"
      @click="item !== mode && select(item)"
    >
      <i />{{ modes[item].label }}<small>{{ modeInfo(item, platform, sandboxed).short }}</small>
    </button>
  </div>
  <div v-if="confirming" class="sheet-backdrop" @click.self="confirming = false">
    <section class="sheet" role="dialog" aria-modal="true" aria-label="确认 Windows 放手模式">
      <h2>在 Windows 上放手</h2>
      <p>这台电脑没有命令沙箱。Anna 会在已信任的文件夹里自主运行普通命令，这些命令直接使用你的系统权限。</p>
      <p>高风险命令、工作区外的修改、读取密钥文件仍逐次确认；Anna 自己的数据禁止访问。命令分类无法限制程序在内部做什么，请只在你信任的项目里使用。</p>
      <p class="small muted">本次选择会记住；你可以在“外观与能力 → 权限模式”里撤销。</p>
      <div class="card-actions"><button @click="confirming = false">取消</button><button class="primary" :disabled="disabled || !trusted" @click="confirm">确认开启放手模式</button></div>
    </section>
  </div>
</template>
