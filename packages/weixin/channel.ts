import type { ApprovalQuestion, WeixinState } from '../shared/contracts'
import { Buffer } from 'node:buffer'
import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import QRCode from 'qrcode'
import * as v from 'valibot'

const BASE = 'https://ilinkai.weixin.qq.com'
const credentialSchema = v.object({ token: v.string(), base: v.string(), owner: v.string(), cursor: v.string(), seen: v.array(v.string()), context: v.optional(v.object({ token: v.string(), at: v.number() })) })
const baseInfo = { channel_version: '0.3.0', bot_agent: 'Anna/0.3.0' }
/** iLink silently drops bot messages once the owner's last context token is older than about a day. */
const contextLifetime = 23 * 60 * 60 * 1000
type Credential = v.InferOutput<typeof credentialSchema>
interface ApiReply {
  ret?: number
  errcode?: number
  status?: string
  qrcode?: string
  qrcode_img_content?: string
  bot_token?: string
  baseurl?: string
  redirect_host?: string
  ilink_user_id?: string
  get_updates_buf?: string
  msgs?: { message_id?: string | number, client_id?: string, from_user_id?: string, message_type?: number, context_token?: string, item_list?: { type?: number, text_item?: { text?: string }, voice_item?: { text?: string } }[] }[]
}
export interface WeixinStorage { read: () => Promise<string>, write: (value: string) => Promise<void> }
/** What the channel needs from the host. */
export interface WeixinAgent {
  submit: (text: string) => Promise<string>
  stop: () => Promise<void>
  busy: () => boolean
  pending: () => number
  status: () => string
  approvals: () => ApprovalQuestion[]
  decide: (id: string, allow: boolean) => void
}
export type InboundRoute = { kind: 'reply', text: string } | { kind: 'decide', id: string, allow: boolean } | { kind: 'stop' } | { kind: 'task', queued: number }

/** Decide what an inbound owner message means. Dangerous approvals stay on the desktop. */
export function routeInbound(text: string, agent: Pick<WeixinAgent, 'busy' | 'pending' | 'status' | 'approvals'>): InboundRoute {
  const command = text.trim().toLowerCase()
  if (command === '/ping')
    return { kind: 'reply', text: 'Anna 已连接。' }
  if (command === '/status' || command === '状态' || command === '进度')
    return { kind: 'reply', text: agent.status() }
  if (command === '/stop' || command === '停止' || command === '停')
    return { kind: 'stop' }
  if (command === '/help')
    return { kind: 'reply', text: '直接发任务给我就行。/status 看进度，/stop 停止当前任务；我请求授权时回复 1 允许、0 拒绝。' }
  const question = agent.approvals()[0]
  if (question && /^(?:1|0|允许|同意|可以|拒绝|不行|不可以)$/.test(command)) {
    if (question.danger)
      return { kind: 'reply', text: `这个操作风险较高（${question.reason}），只能在 Anna 桌面端确认。` }
    return { kind: 'decide', id: question.id, allow: /^(?:1|允许|同意|可以)$/.test(command) }
  }
  return { kind: 'task', queued: agent.busy() ? agent.pending() + 1 : 0 }
}

export function trustedWeixinBase(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || (url.hostname !== 'weixin.qq.com' && !url.hostname.endsWith('.weixin.qq.com')) || url.port || url.username || url.password || url.search || url.hash)
    throw new Error('微信返回了不受信任的服务地址')
  return url.origin
}

/** iLink transport follows Tencent/openclaw-weixin. Tokens stay inside the encrypted desktop vault. */
export class WeixinChannel {
  private credential?: Credential
  private controller?: AbortController
  private task?: Promise<void>
  private verifyCode = ''
  state: WeixinState = { phase: 'offline', message: '微信尚未连接' }
  constructor(private storage: WeixinStorage, private changed: (state: WeixinState) => void, private agent: WeixinAgent) {}
  private publish(state: WeixinState) { this.state = state; this.changed(state) }
  async restore() {
    const saved = await this.storage.read()
    if (!saved)
      return
    this.credential = v.parse(credentialSchema, JSON.parse(saved))
    this.credential.base = trustedWeixinBase(this.credential.base)
    this.controller = new AbortController()
    this.publish({ phase: 'connected', message: '微信连接已恢复，仅响应绑定账号' })
    this.task = this.monitor(this.controller.signal)
  }

  private async api(base: string, endpoint: string, signal: AbortSignal, body?: object, token?: string): Promise<ApiReply> {
    const response = await fetch(new URL(endpoint, trustedWeixinBase(base)), {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': '132102', 'AuthorizationType': 'ilink_bot_token', 'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64'), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([signal, AbortSignal.timeout(40000)]),
    })
    if (!response.ok)
      throw new Error(`微信服务返回 HTTP ${response.status}`)
    const text = await response.text()
    if (text.length > 2000000)
      throw new Error('微信响应超过大小限制')
    const result = JSON.parse(text.replace(/("message_id"\s*:\s*)(\d+)/g, '$1"$2"')) as ApiReply
    if (result.ret || result.errcode)
      throw new Error(`微信服务错误 ${result.errcode ?? result.ret}`)
    return result
  }

  async login() {
    await this.stop()
    this.controller = new AbortController()
    const signal = this.controller.signal
    this.verifyCode = ''
    this.publish({ phase: 'loading', message: '正在获取微信登录二维码…' })
    try {
      const result = await this.api(BASE, '/ilink/bot/get_bot_qrcode?bot_type=3', signal, { local_token_list: [] })
      if (!result.qrcode || !result.qrcode_img_content)
        throw new Error('微信未返回登录二维码')
      const qr = await QRCode.toDataURL(result.qrcode_img_content, { width: 320, margin: 3 })
      this.publish({ phase: 'waiting', message: '打开微信扫一扫，并在手机上确认', qr })
      this.task = this.pollLogin(result.qrcode, signal)
    }
    catch (error) {
      if (!signal.aborted)
        this.publish({ phase: 'error', message: error instanceof Error ? error.message : '获取微信二维码失败' })
    }
  }

  submitCode(code: string) {
    if (!/^\d{4,8}$/.test(code))
      throw new Error('请输入手机上显示的数字验证码')
    this.verifyCode = code
  }

  private async pollLogin(qrcode: string, signal: AbortSignal) {
    let base = BASE
    const expires = Date.now() + 240000
    try {
      while (!signal.aborted && Date.now() < expires) {
        const query = new URLSearchParams({ qrcode, ...(this.verifyCode ? { verify_code: this.verifyCode } : {}) })
        const result = await this.api(base, `/ilink/bot/get_qrcode_status?${query}`, signal)
        if (result.status === 'expired')
          break
        if (result.redirect_host)
          base = trustedWeixinBase(result.redirect_host.includes('://') ? result.redirect_host : `https://${result.redirect_host}`)
        if (result.status === 'scaned')
          this.publish({ ...this.state, phase: 'scanned', message: '已扫码，请在微信中确认' })
        if (result.status === 'need_verifycode')
          this.publish({ ...this.state, phase: 'need-code', message: '请输入微信显示的验证码' })
        if (result.status === 'verify_code_blocked')
          throw new Error('验证码尝试次数过多，请重新扫码')
        if (result.status === 'confirmed') {
          if (!result.bot_token || !result.ilink_user_id)
            throw new Error('微信未返回完整账号信息，请重新扫码')
          this.credential = { token: result.bot_token, base: trustedWeixinBase(result.baseurl ?? base), owner: result.ilink_user_id, cursor: '', seen: [] }
          await this.storage.write(JSON.stringify(this.credential))
          this.publish({ phase: 'connected', message: '微信已连接，仅响应本次扫码账号。Anna 需保持运行。' })
          await this.monitor(signal)
          return
        }
        await delay(1500, undefined, { signal })
      }
      if (!signal.aborted)
        this.publish({ phase: 'expired', message: '二维码已过期，请刷新' })
    }
    catch (error) {
      if (!signal.aborted)
        this.publish({ phase: 'error', message: error instanceof Error ? error.message : '微信连接失败' })
    }
  }

  private async monitor(signal: AbortSignal) {
    while (!signal.aborted && this.credential) {
      const account = this.credential
      try {
        const updates = await this.api(account.base, '/ilink/bot/getupdates', signal, { get_updates_buf: account.cursor, base_info: baseInfo }, account.token)
        if (this.state.phase !== 'connected')
          this.publish({ phase: 'connected', message: '微信已重新连接，仅响应绑定账号' })
        for (const message of updates.msgs ?? []) {
          if (signal.aborted)
            return
          if (message.from_user_id !== account.owner || message.message_type !== 1 || !message.context_token)
            continue
          const id = String(message.message_id ?? message.client_id ?? '')
          if (!id || account.seen.includes(id))
            continue
          const text = (message.item_list ?? []).map(item => item.text_item?.text ?? item.voice_item?.text ?? '').join('\n').trim()
          account.seen = [...account.seen.slice(-199), id]
          account.context = { token: message.context_token, at: Date.now() }
          await this.storage.write(JSON.stringify(account))
          if (text)
            void this.handle(text.slice(0, 30000), message.context_token, signal)
        }
        if (updates.get_updates_buf)
          account.cursor = updates.get_updates_buf
        await this.storage.write(JSON.stringify(account))
        await delay(1000, undefined, { signal })
      }
      catch (error) {
        if (signal.aborted)
          return
        const message = error instanceof Error ? error.message : '微信连接中断'
        if (/错误 -14/.test(message)) { this.publish({ phase: 'offline', message: '微信登录已过期，请重新扫码' }); return }
        this.publish({ phase: 'error', message: `${message}。5 秒后重新连接。` })
        try { await delay(5000, undefined, { signal }) }
        catch { return }
      }
    }
  }

  /** Handle one inbound message without blocking the poll loop: commands answer at once, tasks are queued in the host. */
  private async handle(text: string, context: string, signal: AbortSignal) {
    const route = routeInbound(text, this.agent)
    try {
      if (route.kind === 'reply') {
        await this.send(route.text, context, signal)
        return
      }
      if (route.kind === 'decide') {
        this.agent.decide(route.id, route.allow)
        await this.send(route.allow ? '好，已允许，继续干活。' : '好，已拒绝。我换个办法。', context, signal)
        return
      }
      if (route.kind === 'stop') {
        await this.agent.stop()
        await this.send('已经停下了当前任务，排队的任务也取消了。', context, signal)
        return
      }
      if (route.queued)
        await this.send(`收到。我手上还有任务，这条排在第 ${route.queued} 个，轮到时开始。发 /status 看进度，/stop 停止。`, context, signal)
      const answer = await this.agent.submit(text).catch(error => `这次任务没有完成：${error instanceof Error ? error.message : '未知错误'}。可以在 Anna 桌面端查看详情。`)
      await this.send(answer, context, signal)
    }
    catch (error) {
      if (!signal.aborted)
        this.publish({ phase: 'error', message: error instanceof Error ? error.message : '微信回复失败' })
    }
  }

  private async send(text: string, context: string, signal: AbortSignal) {
    const account = this.credential
    if (!account)
      return
    for (let offset = 0; offset < Math.min(text.length, 36000); offset += 3000) {
      await this.api(account.base, '/ilink/bot/sendmessage', signal, { msg: { from_user_id: '', to_user_id: account.owner, client_id: `anna-${randomUUID()}`, message_type: 2, message_state: 2, context_token: context, item_list: [{ type: 1, text_item: { text: text.slice(offset, offset + 3000) } }] }, base_info: baseInfo }, account.token)
    }
  }

  /** Proactive push (approval requests, milestones). iLink accepts it only with a context token from the owner's last ~24 hours. */
  async notify(text: string) {
    const account = this.credential
    const context = account?.context
    if (!account || !context || Date.now() - context.at > contextLifetime || !this.controller || this.controller.signal.aborted)
      return false
    await this.send(text, context.token, this.controller.signal).catch(() => {})
    return true
  }

  async stop() { this.controller?.abort(); await this.task; this.task = undefined }
  async disconnect() {
    await this.stop()
    this.credential = undefined
    await this.storage.write('')
    this.publish({ phase: 'offline', message: '已移除本机微信凭据' })
  }
}
