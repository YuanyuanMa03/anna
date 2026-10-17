import type { ApprovalQuestion } from '../packages/shared/contracts'
import { describe, expect, it } from 'vitest'
import { routeInbound } from '../packages/weixin/channel'

const question: ApprovalQuestion = { id: 'q1', toolName: 'bash', reason: '运行终端命令', details: 'pnpm install', rule: 'Bash(pnpm install:*)', danger: false, origin: 'weixin' }
const agent = (overrides: Partial<{ busy: boolean, pending: number, approvals: ApprovalQuestion[] }> = {}) => ({ busy: () => overrides.busy ?? false, pending: () => overrides.pending ?? 0, status: () => 'Anna：空闲', approvals: () => overrides.approvals ?? [] })

describe('weixin routing', () => {
  it('answers commands without touching the task queue', () => {
    expect(routeInbound('/ping', agent())).toEqual({ kind: 'reply', text: 'Anna 已连接。' })
    expect(routeInbound('/status', agent())).toEqual({ kind: 'reply', text: 'Anna：空闲' })
    expect(routeInbound('停止', agent())).toEqual({ kind: 'stop' })
  })
  it('queues tasks behind the running one', () => {
    expect(routeInbound('修一下测试', agent())).toEqual({ kind: 'task', queued: 0 })
    expect(routeInbound('再写个 README', agent({ busy: true, pending: 1 }))).toEqual({ kind: 'task', queued: 2 })
  })
  it('turns 1/0 into approval decisions, but keeps dangerous ones on the desktop', () => {
    expect(routeInbound('1', agent({ approvals: [question] }))).toEqual({ kind: 'decide', id: 'q1', allow: true })
    expect(routeInbound('拒绝', agent({ approvals: [question] }))).toEqual({ kind: 'decide', id: 'q1', allow: false })
    expect(routeInbound('1', agent({ approvals: [{ ...question, danger: true }] })).kind).toBe('reply')
    expect(routeInbound('1', agent()).kind).toBe('task')
  })
})

describe('rpc', () => {
  it('fails fast once the other side is gone instead of hanging', async () => {
    const { RpcPeer } = await import('../packages/shared/rpc')
    const sent: unknown[] = []
    const peer = new RpcPeer(message => sent.push(message), {})
    const inflight = peer.call('execute', {})
    peer.fail('gone')
    await expect(inflight).rejects.toThrow('gone')
    await expect(peer.call('execute', {})).rejects.toThrow('gone')
    expect(sent).toHaveLength(1)
  })
})
