<script setup lang="ts">
import type { AgentStatus, Command, RuntimeSnapshot } from '../../../../packages/shared/contracts'
import { computed, ref, watch } from 'vue'
import ProvidersPanel from './providers-panel.vue'

const props = defineProps<{ snapshot: RuntimeSnapshot, locked: boolean, error?: string }>()
const emit = defineEmits<{ command: [command: Command], close: [] }>()
const installing = ref<string>()
const confirmInstall = ref<AgentStatus>()
/** The panel grows section by section as cc-switch's features arrive. */
const tab = ref<'agents' | 'providers'>(props.snapshot.agents.pendingImport ? 'providers' : 'agents')
// An import link waiting for confirmation brings the providers tab forward.
watch(() => props.snapshot.agents.pendingImport, (pending) => {
  if (pending)
    tab.value = 'providers'
})
const agents = computed(() => props.snapshot.agents)
const delegates = computed(() => agents.value.detected.filter(agent => agent.tier === 'delegate'))
const switchOnly = computed(() => agents.value.detected.filter(agent => agent.tier === 'switch'))
function install(agent: AgentStatus) {
  confirmInstall.value = undefined
  installing.value = agent.id
  emit('command', { type: 'agent-install', agent: agent.id })
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <section class="sheet agents" role="dialog" aria-modal="true" aria-label="外部 agent">
      <div class="sheet-heading"><div><span class="eyebrow">COLLEAGUES</span><h2>外部 agent</h2></div><button class="icon-button" aria-label="关闭外部 agent" @click="emit('close')">×</button></div>
      <div class="sheet-tabs" role="tablist" aria-label="外部 agent 分区">
        <button role="tab" :aria-selected="tab === 'agents'" data-tab="agents" @click="tab = 'agents'">Agent</button>
        <button role="tab" :aria-selected="tab === 'providers'" data-tab="providers" @click="tab = 'providers'">服务商</button>
      </div>
      <ProvidersPanel v-if="tab === 'providers'" :snapshot="snapshot" :locked="locked" @command="emit('command', $event)" />
      <template v-else>
        <p class="muted small">Anna 会像 cc-switch 一样识别这台电脑上的 coding agent。在输入框写 <code>@claude 任务</code> 或 <code>@codex 任务</code> 把活交给它，或者让 Anna 自己判断要不要派。它们的修改同样受权限模式约束，交付后可以查看 diff 和撤销。</p>
        <div class="card-actions left"><button :disabled="locked" @click="emit('command', { type: 'agents-refresh' })">重新检测</button><button v-if="agents.ccSwitch" :disabled="locked" @click="emit('command', { type: 'ccswitch-import' })">从 cc-switch 导入服务商</button></div>

        <h3>能派活的 agent</h3>
        <ul class="agent-list">
          <li v-for="agent in delegates" :key="agent.id" :data-agent="agent.id" :class="{ missing: !agent.installed }">
            <div class="agent-main">
              <strong>{{ agent.label }}</strong>
              <span v-if="agent.installed" class="badge ok">v{{ agent.version ?? '?' }}</span>
              <span v-else class="badge">未安装</span>
              <span v-if="agent.installed && agent.loggedIn === false" class="badge warn">未登录</span>
              <span v-if="agent.approvals" class="badge">{{ agent.approvals === 'forwarded' ? '逐步授权' : '派活前一次确认' }}</span>
              <span v-if="agent.verified === false" class="badge muted-badge" title="适配器按官方协议实现，尚未在真机录制验证">未真机验证</span>
            </div>
            <p class="small muted">{{ agent.installed ? agent.path : agent.install ? `安装命令：${agent.install}` : '' }}</p>
            <button v-if="!agent.installed && agent.install" :disabled="locked || installing === agent.id" @click="confirmInstall = agent">{{ installing === agent.id ? '正在安装…' : '安装' }}</button>
          </li>
        </ul>

        <div v-if="confirmInstall" class="card approval-request" role="alert">
          <strong>安装 {{ confirmInstall.label }}？</strong>
          <pre>{{ confirmInstall.install }}</pre>
          <p class="small muted">会用 npm 全局安装。安装后需要在终端里登录一次（例如运行 {{ confirmInstall.id }} 并按提示登录）。</p>
          <div class="card-actions"><button @click="confirmInstall = undefined">取消</button><button class="primary" @click="install(confirmInstall)">安装</button></div>
        </div>

        <h3>仅识别（暂不能派活）</h3>
        <ul class="agent-list compact">
          <li v-for="agent in switchOnly" :key="agent.id"><strong>{{ agent.label }}</strong><span class="badge" :class="{ ok: agent.installed }">{{ agent.installed ? `已安装${agent.version ? ` v${agent.version}` : ''}` : '未安装' }}</span></li>
        </ul>
      </template>
      <p class="small muted">密钥保存在{{ snapshot.platform.secrets === 'file' ? '只有你能读的本地文件里（这台电脑没有系统钥匙串）' : '系统钥匙串加密存储里' }}。</p>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </div>
</template>
