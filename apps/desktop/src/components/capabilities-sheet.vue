<script setup lang="ts">
import type { Command, RuntimeSnapshot } from '../../../../packages/shared/contracts'
import { computed } from 'vue'
import { characters } from '../../../../packages/character/manifest'
import { modeOrder, modes } from '../../../../packages/permissions/modes'

const props = defineProps<{ snapshot: RuntimeSnapshot, locked: boolean, error?: string }>()
const emit = defineEmits<{ command: [command: Command], close: [] }>()
const rules = computed(() => [
  ...props.snapshot.workspace.rules.deny.map(rule => ({ rule, kind: '禁止' })),
  ...props.snapshot.workspace.rules.ask.map(rule => ({ rule, kind: '先问' })),
  ...props.snapshot.workspace.rules.allow.map(rule => ({ rule, kind: '允许' })),
  ...props.snapshot.sessionRules.map(rule => ({ rule, kind: '本次会话' })),
])
const isDefault = computed(() => !props.snapshot.settings.workspace)
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <section class="sheet capabilities" role="dialog" aria-modal="true" aria-label="外观与能力">
      <div class="sheet-heading"><div><span class="eyebrow">COMPOSABLE SOUL</span><h2>外观与能力</h2></div><button class="icon-button" aria-label="关闭外观与能力" @click="emit('close')">×</button></div>

      <h3>外观</h3>
      <div class="character-cards" role="group" aria-label="选择角色">
        <button v-for="item in characters" :key="item.id" :aria-label="`选择 ${item.name}`" :aria-pressed="snapshot.settings.characterId === item.id" class="character-card" :class="[{ selected: snapshot.settings.characterId === item.id }]" @click="emit('command', { type: 'character', id: item.id })"><img :src="item.thumbnailPath" :alt="item.label"><span><strong>{{ item.name }}</strong><small>{{ item.label }}</small></span></button>
      </div>
      <p class="small muted">外观切换不改变对话和人格。角色素材属于 Live2D 样例，使用前请阅读随附许可证。</p>

      <div class="plugin-row">
        <div><h3>工作文件夹</h3><p>{{ snapshot.workspace.path }}</p><span>{{ isDefault ? 'Anna 自己的默认工作区（已信任）' : snapshot.workspace.trusted ? '已信任：加载项目说明（AGENTS.md），可使用协作与放手模式' : '未信任：不加载项目说明，只能使用规划和谨慎模式' }}</span></div>
        <button :disabled="locked" @click="emit('command', { type: 'choose-workspace' })">选择工作文件夹</button>
      </div>
      <button v-if="!isDefault && snapshot.workspace.known" :disabled="locked" @click="emit('command', { type: 'trust', trusted: !snapshot.workspace.trusted })">{{ snapshot.workspace.trusted ? '取消信任这个文件夹' : '信任这个文件夹' }}</button>

      <h3>权限模式</h3>
      <dl class="mode-table">
        <template v-for="item in modeOrder" :key="item">
          <dt :data-mode="item" :class="{ current: snapshot.mode === item }"><i />{{ modes[item].label }}</dt>
          <dd>{{ modes[item].description }}</dd>
        </template>
      </dl>
      <p class="small muted">在输入框里按 Shift+Tab 切换模式。微信派来的任务始终按“谨慎”执行。读取凭据目录（~/.ssh、~/.aws 等）和 Anna 自己的数据在任何模式下都会被拒绝。</p>

      <h3>命令沙箱</h3>
      <p class="small" :class="snapshot.platform.sandbox.available ? 'ok' : 'warn'">{{ snapshot.platform.sandbox.available ? '已启用：终端命令只能写工作文件夹、临时目录和包管理缓存；读取凭据目录会被系统拒绝；每个联网地址都要经过确认（放手模式自动放行常用软件源）。' : `不可用：${snapshot.platform.sandbox.reason ?? '未知原因'}。放手模式下修改类命令仍会先问你。` }}</p>

      <h3>权限规则</h3>
      <p v-if="!rules.length" class="small muted">还没有规则。在确认卡上选“总是允许”或“本次会话都允许”会出现在这里。</p>
      <ul class="rule-list">
        <li v-for="item in rules" :key="item.kind + item.rule"><span class="badge">{{ item.kind }}</span><code>{{ item.rule }}</code><button class="link" @click="emit('command', { type: 'rule-remove', rule: item.rule })">删除</button></li>
      </ul>

      <div class="plugin-row"><div><h3>长期记忆</h3><p>Anna 记住你的偏好与约定，跨会话生效。</p></div><button :disabled="locked || !snapshot.hasKey" :aria-pressed="snapshot.settings.memoryEnabled" @click="emit('command', { type: 'memory', enabled: !snapshot.settings.memoryEnabled })">{{ snapshot.settings.memoryEnabled ? '关闭记忆' : '开启记忆' }}</button></div>
      <p v-if="!snapshot.memories.length" class="small muted">还没有记忆。可以直接对 Anna 说“记住……”。</p>
      <ul class="rule-list">
        <li v-for="item in snapshot.memories" :key="item.id"><span>{{ item.text }}</span><button class="link" @click="emit('command', { type: 'memory-forget', id: item.id })">忘记</button></li>
      </ul>

      <div class="plugin-row"><div><h3>Anna Status</h3><p>读取版本、内核、模型、权限与插件。</p><span>{{ snapshot.plugins.includes('anna-status') ? '实际已加载' : '未加载' }}</span></div><button :disabled="locked || !snapshot.hasKey" :aria-pressed="snapshot.settings.statusEnabled" @click="emit('command', { type: 'plugin', enabled: !snapshot.settings.statusEnabled })">{{ snapshot.settings.statusEnabled ? '禁用状态工具' : '启用状态工具' }}</button></div>
      <p class="muted small">大脑：{{ snapshot.kernel.label }}（可在“模型与设置”里换成 Claude Code 或 Codex）· 系统：{{ snapshot.platform.os }} / {{ snapshot.platform.shell }}<br>插件：{{ snapshot.plugins.join('、') || '未启动' }}<br>实际工具注册表：{{ snapshot.tools.join('、') || '无' }}<br>运行时：{{ snapshot.state }}</p>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </div>
</template>
