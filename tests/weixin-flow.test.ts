import type { ApprovalQuestion, WeixinState } from '../packages/shared/contracts'
import { afterEach, expect, it, vi } from 'vitest'
import { WeixinChannel } from '../packages/weixin/channel'

/** A fake iLink backend following Tencent/openclaw-weixin docs/protocol.md. */
function fakeIlink() {
  const inbox: object[] = []
  const sent: { text: string, context: string, to: string }[] = []
  let statusCalls = 0
  const fetch = vi.fn(async (url: URL, init?: RequestInit) => {
    const path = url.pathname
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    const reply = (value: object) => new Response(JSON.stringify(value), { status: 200 })
    expect(url.hostname.endsWith('weixin.qq.com')).toBe(true)
    if (path === '/ilink/bot/get_bot_qrcode')
      return reply({ ret: 0, qrcode: 'qr-1', qrcode_img_content: 'https://ilinkai.weixin.qq.com/qr/abc' })
    if (path === '/ilink/bot/get_qrcode_status')
      return reply(++statusCalls === 1 ? { status: 'scaned' } : { status: 'confirmed', bot_token: 'bot-token', ilink_user_id: 'owner@im.wechat', baseurl: 'https://ilinkai.weixin.qq.com' })
    if (path === '/ilink/bot/getupdates') {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer bot-token')
      expect(body.base_info.channel_version).toBeTruthy()
      await new Promise(resolve => setTimeout(resolve, 20))
      return reply({ ret: 0, msgs: inbox.splice(0), get_updates_buf: `cursor-${Date.now()}` })
    }
    if (path === '/ilink/bot/sendmessage') {
      expect(body.msg).toMatchObject({ message_type: 2, message_state: 2, to_user_id: 'owner@im.wechat' })
      sent.push({ text: body.msg.item_list[0].text_item.text, context: body.msg.context_token, to: body.msg.to_user_id })
      return reply({ ret: 0 })
    }
    return new Response('not found', { status: 404 })
  })
  let id = 0
  const say = (text: string, from = 'owner@im.wechat') => inbox.push({ message_id: ++id, from_user_id: from, message_type: 1, context_token: `ctx-${id}`, item_list: [{ type: 1, text_item: { text } }] })
  return { fetch, sent, say }
}

afterEach(() => { vi.unstubAllGlobals() })

it('logs in by QR, queues tasks without blocking, pushes approvals, and replies with results', async () => {
  const ilink = fakeIlink()
  vi.stubGlobal('fetch', ilink.fetch)
  let stored = ''
  const states: WeixinState[] = []
  // A fake host: one task at a time, the first one needs an approval.
  const approvals: ApprovalQuestion[] = []
  const decisions: boolean[] = []
  let running = 0
  let queued = 0
  let channel!: WeixinChannel
  const agent = {
    busy: () => running > 0,
    pending: () => queued,
    status: () => `Anna：${running ? '运行命令' : '空闲'}`,
    approvals: () => approvals,
    stop: async () => {},
    decide: (questionId: string, allow: boolean) => { const index = approvals.findIndex(q => q.id === questionId); approvals.splice(index, 1); decisions.push(allow) },
    submit: async (text: string) => {
      if (running) { queued++; await vi.waitUntil(() => !running, { timeout: 8000, interval: 20 }); queued-- }
      running++
      try {
        if (text.includes('安装')) {
          approvals.push({ id: 'q1', toolName: 'bash', reason: '运行终端命令', details: 'pnpm install', rule: 'Bash(pnpm install:*)', danger: false, origin: 'weixin' })
          await channel.notify('Anna 需要你确认（运行终端命令）：\npnpm install\n回复 1 允许，0 拒绝。')
          await vi.waitUntil(() => decisions.length > 0, { timeout: 8000, interval: 20 })
          return decisions[0] ? '装好了依赖，测试通过。' : '你拒绝了安装，我没有改动。'
        }
        return `完成：${text}`
      }
      finally { running-- }
    },
  }
  channel = new WeixinChannel({ read: async () => stored, write: async (value) => { stored = value } }, state => states.push(state), agent)

  await channel.login()
  expect(states.some(state => state.phase === 'waiting' && state.qr?.startsWith('data:image/png'))).toBe(true)
  await vi.waitUntil(() => channel.state.phase === 'connected', { timeout: 8000, interval: 50 })
  expect(states.map(state => state.phase)).toContain('scanned')
  expect(JSON.parse(stored)).toMatchObject({ token: 'bot-token', owner: 'owner@im.wechat' })

  ilink.say('/ping')
  ilink.say('我是陌生人', 'stranger@im.wechat')
  await vi.waitUntil(() => ilink.sent.length >= 1, { timeout: 5000, interval: 20 })
  expect(ilink.sent[0]).toMatchObject({ text: 'Anna 已连接。', context: 'ctx-1' })

  // A task that needs approval, then a second task while the first is still running.
  ilink.say('帮我安装依赖')
  await vi.waitUntil(() => ilink.sent.some(item => item.text.includes('回复 1 允许')), { timeout: 5000, interval: 20 })
  ilink.say('再写一个 README')
  await vi.waitUntil(() => ilink.sent.some(item => item.text.includes('排在第 1 个')), { timeout: 5000, interval: 20 })
  ilink.say('/status')
  await vi.waitUntil(() => ilink.sent.some(item => item.text === 'Anna：运行命令'), { timeout: 5000, interval: 20 })
  ilink.say('1')
  await vi.waitUntil(() => ilink.sent.some(item => item.text === '装好了依赖，测试通过。'), { timeout: 5000, interval: 20 })
  await vi.waitUntil(() => ilink.sent.some(item => item.text === '完成：再写一个 README'), { timeout: 8000, interval: 20 })

  expect(decisions).toEqual([true])
  expect(ilink.sent.some(item => item.text.includes('陌生人'))).toBe(false)
  // Each reply goes back on the context token of the message it answers; the approval push uses the latest one.
  expect(ilink.sent.find(item => item.text === '装好了依赖，测试通过。')?.context).toBe('ctx-3')
  expect(ilink.sent.find(item => item.text === '完成：再写一个 README')?.context).toBe('ctx-4')
  expect(JSON.parse(stored).context.token).toMatch(/^ctx-/)
  await channel.stop()
}, 30000)
