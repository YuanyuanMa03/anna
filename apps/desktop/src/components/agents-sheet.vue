<script setup lang="ts">
import type { AgentStatus, Command, RuntimeSnapshot } from '../../../../packages/shared/contracts'
import { computed, reactive, ref } from 'vue'

const props = defineProps<{ snapshot: RuntimeSnapshot, locked: boolean, error?: string }>()
const emit = defineEmits<{ command: [command: Command], close: [] }>()
const apps = ['claude', 'codex', 'gemini'] as const
const installing = ref<string>()
const confirmInstall = ref<AgentStatus>()
const drafts = reactive<Record<string, { provider: string, key: string }>>({})
const agents = computed(() => props.snapshot.agents)
const delegates = computed(() => agents.value.detected.filter(agent => agent.tier === 'delegate'))
const switchOnly = computed(() => agents.value.detected.filter(agent => agent.tier === 'switch'))
const draft = (app: string) => (drafts[app] ??= { provider: agents.value.providers[app]?.provider ?? '', key: '' })
const keyUrl = (app: string) => agents.value.presets[app]?.find(preset => preset.name === draft(app).provider)?.apiKeyUrl

function saveProvider(app: string) {
  const { provider, key } = draft(app)
  emit('command', { type: 'agent-provider', agent: app, provider: provider || undefined, key: key || undefined })
  draft(app).key = ''
}
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

      <h3>服务商</h3>
      <p class="small muted">派活或把它当大脑时，Anna 只给那个 agent 的进程注入所选服务商，不改你的配置文件。“应用到全局”才会像 cc-switch 一样写入它的配置（只改连接相关的字段，首次写入前会备份，可以一键恢复）。预设来自 cc-switch（MIT）。</p>
      <div v-for="app in apps" :key="app" class="provider-row" :data-app="app">
        <strong>{{ agents.detected.find(agent => agent.id === app)?.label ?? app }}</strong>
        <label>服务商<select v-model="draft(app).provider" :aria-label="`${app} 服务商`"><option value="">使用它自己的登录</option><option v-for="preset in agents.presets[app] ?? []" :key="preset.name" :value="preset.name">{{ preset.name }}{{ preset.category === 'imported' ? '（导入）' : '' }}</option></select></label>
        <label v-if="draft(app).provider">API Key<input v-model="draft(app).key" type="password" autocomplete="off" :aria-label="`${app} API Key`" :placeholder="agents.providers[app]?.hasKey && agents.providers[app]?.provider === draft(app).provider ? '已保存，留空保持' : '输入服务商密钥'"></label>
        <a v-if="keyUrl(app)" class="link small" :href="keyUrl(app)" target="_blank" rel="noreferrer">去获取密钥 ↗</a>
        <div class="card-actions left">
          <button :disabled="locked" @click="saveProvider(app)">派活时使用</button>
          <button v-if="draft(app).provider" :disabled="locked" @click="saveProvider(app); emit('command', { type: 'provider-global', app, provider: draft(app).provider })">应用到全局</button>
          <button v-if="agents.global[app]?.switched" :disabled="locked" @click="emit('command', { type: 'provider-restore', app })">恢复原配置</button>
        </div>
        <p class="small muted">派活：{{ agents.providers[app]?.provider ?? '它自己的登录' }} · 全局：{{ agents.global[app]?.switched ? `已切换到 ${agents.global[app]?.provider}` : '未修改' }}</p>
      </div>

      <h3>仅识别（暂不能派活）</h3>
      <ul class="agent-list compact">
        <li v-for="agent in switchOnly" :key="agent.id"><strong>{{ agent.label }}</strong><span class="badge" :class="{ ok: agent.installed }">{{ agent.installed ? `已安装${agent.version ? ` v${agent.version}` : ''}` : '未安装' }}</span></li>
      </ul>
      <p class="small muted">密钥保存在{{ snapshot.platform.secrets === 'file' ? '只有你能读的本地文件里（这台电脑没有系统钥匙串）' : '系统钥匙串加密存储里' }}。</p>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </div>
</template>
