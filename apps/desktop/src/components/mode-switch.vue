<script setup lang="ts">
import type { PermissionMode } from '../../../../packages/shared/contracts'
import { modeOrder, modes } from '../../../../packages/permissions/modes'

const props = defineProps<{ mode: PermissionMode, trusted: boolean, disabled?: boolean }>()
const emit = defineEmits<{ change: [mode: PermissionMode] }>()
const available = (mode: PermissionMode) => props.trusted || !modes[mode].needsTrust

/** Shift+Tab cycles through the modes the workspace allows, like Claude Code. */
function cycle() {
  const allowed = modeOrder.filter(available)
  emit('change', allowed[(allowed.indexOf(props.mode) + 1) % allowed.length]!)
}
defineExpose({ cycle })
</script>

<template>
  <div class="mode-switch" role="radiogroup" aria-label="权限模式" :data-mode="mode">
    <button
      v-for="item in modeOrder" :key="item" type="button" role="radio" :aria-checked="mode === item" :data-mode="item"
      :disabled="disabled || !available(item)" :title="available(item) ? modes[item].description : '只能在你信任的工作文件夹里使用'"
      @click="item !== mode && emit('change', item)"
    >
      <i />{{ modes[item].label }}<small>{{ modes[item].short }}</small>
    </button>
  </div>
</template>
