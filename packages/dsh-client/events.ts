import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import type { AnnaEvent } from '../shared/contracts'
import { validatedSessionEvent } from '@deepseek-ai/dsh-sdk-client'

/** The adapter keeps DSH event shapes outside the renderer contract. Call IDs correlate tool results within one runtime. */
export class EventAdapter {
  private calls = new Map<string, string>()
  adapt(notification: HarnessNotification): AnnaEvent | undefined {
    if (notification.method !== 'session.event')
      return
    const event = validatedSessionEvent(notification.params.event)
    if (event.type === 'tool/call') {
      this.calls.set(event.data.callId, event.data.name)
      return { type: 'tool', phase: 'call', name: event.data.name, text: '正在调用' }
    }
    if (event.type === 'tool/result') {
      const id = event.data.message.toolCallId
      const name = this.calls.get(id) ?? 'tool'
      this.calls.delete(id)
      return { type: 'tool', phase: 'result', name, text: event.data.message.content.map(block => block.type === 'text' ? block.text : `[${block.type}]`).join('\n') }
    }
    if (event.type === 'step/start')
      return { type: 'activity', text: 'Anna 正在思考…' }
    if (event.type === 'assistant/attempt')
      return { type: 'activity', text: '模型请求未完成，请检查连接状态' }
  }
}
