import type { Command } from '../../packages/shared/contracts'
import type { Wire } from '../../packages/shared/rpc'
import { join } from 'node:path'
import process from 'node:process'
import { Host } from '../../packages/anna-host/host'
import { companion } from '../../packages/character/manifest'
import { RpcPeer } from '../../packages/shared/rpc'
import { WeixinChannel } from '../../packages/weixin/channel'

/**
 * Anna core: runs in an Electron utility process so the agent kernel, sandbox proxies and remote channels
 * can neither freeze nor crash the window. Main only lends it the system credential store.
 */
const parent = process.parentPort
const root = process.env.ANNA_CORE_ROOT!
const data = process.env.ANNA_CORE_DATA!
let host: Host | undefined
let weixin: WeixinChannel | undefined
let markReady!: () => void
const ready = new Promise<void>((resolve) => { markReady = resolve })

const phaseNames: Record<string, string> = { offline: '离线', idle: '空闲', thinking: '思考中', responding: '正在回复', inspecting: '查看资料', editing: '修改文件', running: '运行命令', testing: '验证中', waiting: '等你确认', compacting: '整理上下文', retrying: '重试中', supervising: '在看其他 agent 干活', done: '刚完成', failed: '遇到问题' }

const peer = new RpcPeer(message => parent.postMessage(message), {
  execute: async (command: Command) => {
    await ready
    switch (command.type) {
      case 'weixin-login': await weixin!.login(); break
      case 'weixin-disconnect': await weixin!.disconnect(); break
      case 'weixin-code': weixin!.submitCode(command.code); break
      case 'weixin-status': peer.event({ type: 'weixin', state: weixin!.state }); break
      default: return host!.execute(command)
    }
    return host!.snapshot()
  },
  shutdown: async () => {
    await Promise.allSettled([host?.close(), weixin?.stop()])
    setTimeout(() => process.exit(0), 50)
  },
})
parent.on('message', event => void peer.receive(event.data as Wire))

function vaultFor(name: string) {
  // Deterministic tests run with a scripted model and a fixed key; the system keychain is never touched.
  const testKey = process.env.ANNA_TEST_SCRIPT && name === 'credential.bin' ? process.env.ANNA_TEST_KEY : undefined
  return {
    read: () => testKey ? Promise.resolve(testKey) : peer.call<string>('vault.read', { name }),
    write: (value: string) => peer.call<void>('vault.write', { name, value }),
  }
}

async function main() {
  // Deterministic desktop tests swap external agents for the protocol-faithful fake (tests/fixtures/fake-agent.mjs).
  const fake = process.env.ANNA_TEST_SCRIPT ? process.env.ANNA_TEST_FAKE_AGENT : undefined
  host = new Host(root, data, vaultFor('credential.bin'), event => peer.event(event), {
    ...(fake
      ? { agents: {
          locate: agent => ({ command: process.env.ANNA_TEST_NODE ?? 'node', prefix: [fake, agent] }),
          detect: async () => (['claude', 'codex'] as const).map(id => ({ id, label: id === 'claude' ? 'Claude Code' : 'Codex', tier: 'delegate' as const, installed: true, path: `/fake/${id}`, version: '9.9.9', loggedIn: true, configured: true, configDir: '/fake' })),
          // Global switching and routing write the agents' own configs: here, folders of the test's data, never ~.
          configDirs: { claude: join(data, 'test-home/.claude'), codex: join(data, 'test-home/.codex'), gemini: join(data, 'test-home/.gemini') },
          routingPort: 0,
        } }
      : {}),
    secrets: vaultFor('providers.bin'),
    secretsMode: () => peer.call<'system' | 'file'>('vault.mode'),
  })
  await host.initialize()
  const h = host
  weixin = new WeixinChannel(vaultFor('weixin-credential.bin'), state => peer.event({ type: 'weixin', state }), {
    submit: text => h.submit(text, 'weixin'),
    stop: () => h.stopWork(),
    busy: () => h.busy,
    pending: () => h.pending,
    approvals: () => h.snapshot().approvals.filter(question => question.origin === 'weixin'),
    decide: (id, allow) => { h.execute({ type: 'approval', id, allow }).catch(() => {}) },
    status: () => {
      const snapshot = h.snapshot()
      const anna = snapshot.anna
      const lines = [`${companion(snapshot.settings.characterId).name}：${phaseNames[anna.phase] ?? anna.phase}${anna.line ? ` · ${anna.line}` : ''}`, `权限模式：微信任务按「谨慎」执行`]
      if (anna.step)
        lines.push(`本轮已执行 ${anna.step} 步`)
      if (snapshot.queue.length)
        lines.push(`排队中：${snapshot.queue.length} 个任务`)
      if (snapshot.approvals.length)
        lines.push(`等待确认：${snapshot.approvals[0]!.reason}`)
      lines.push(`工作文件夹：${snapshot.workspace.path}`)
      return lines.join('\n')
    },
  })
  host.channels.set('weixin', { notify: text => weixin!.notify(text) })
  await weixin.restore().catch(() => peer.event({ type: 'weixin', state: { phase: 'error', message: '微信凭据无法恢复，请重新扫码' } }))
  markReady()
  peer.event({ type: 'core', status: 'ready' })
}

process.on('uncaughtException', (error) => { console.error('[anna-core]', error); process.exit(1) })
void main().catch((error) => {
  console.error('[anna-core] startup failed', error)
  process.exit(1)
})
