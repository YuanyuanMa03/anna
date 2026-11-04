<script setup lang="ts">
import { onMounted, ref } from 'vue'

defineEmits<{ close: [] }>()
const revision = ref(0)
const url = ref('')
const error = ref('')
async function connect() {
  error.value = ''
  const result = await window.anna.gateway()
  if (result.ok) { url.value = result.url; revision.value++ }
  else { error.value = result.error }
}
onMounted(connect)
</script>

<template>
  <div class="sheet-backdrop gateway-backdrop" @click.self="$emit('close')">
    <section class="gateway-sheet" role="dialog" aria-label="Anna 服务工作台" aria-modal="true">
      <header class="sheet-heading">
        <div><h2>Anna · 服务工作台</h2><p class="small muted">模型、听觉与声音，在这里接通。</p></div>
        <div class="gateway-actions"><button @click="connect">重新连接</button><button class="icon-button" aria-label="关闭服务工作台" @click="$emit('close')">×</button></div>
      </header>
      <p class="gateway-hint">独立网关需先启动：<code>node apps/gateway/cli.mjs start</code>。若页面未显示，请检查本机 17865 工作台端口；关闭此页不会停止独立网关。</p>
      <p v-if="error" class="gateway-hint" role="alert">{{ error }}</p>
      <iframe v-if="url" :key="revision" :src="url" title="Anna 网关管理页面" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" referrerpolicy="no-referrer" allow="clipboard-write; camera 'none'; microphone 'none'; geolocation 'none'" />
    </section>
  </div>
</template>

<style scoped>
.gateway-backdrop { justify-content: center; padding: 20px }
.gateway-sheet { width: min(1440px, 100%); display: flex; flex-direction: column; background: #f5f2e9; color: #293a31; border: 1px solid #e0e3d7; border-radius: 22px; overflow: hidden }
.sheet-heading { padding: 18px 24px }
.sheet-heading h2 { margin: 0; font-size: 18px }
.sheet-heading p { margin: 4px 0 0 }
.gateway-actions { display: flex; align-items: center; gap: 12px }
.gateway-hint { font-size: 11px; color: #778075; padding: 0 24px 12px; margin: 0; line-height: 1.7 }
iframe { flex: 1; border: 0; width: 100%; min-height: 300px; background: #f5f2e9 }
@media (max-width: 700px) { .gateway-backdrop { padding: 6px } .sheet-heading { padding: 14px } .gateway-hint { padding: 0 14px 10px } }
</style>
