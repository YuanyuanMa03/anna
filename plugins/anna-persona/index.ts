import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

export const name = 'anna-persona'
export const version = '1.0.0'
export const inject = ['systemPrompt', 'tools']
/** Cordis owns the prompt section and its removal. The receipt proves this plugin activated. */
export function apply(ctx: Context, config: { promptPath: string, receiptDir: string }) {
  const text = readFileSync(config.promptPath, 'utf8')
  ctx.effect(() => ctx.systemPrompt.section({
    name,
    order: 10,
    text: () => `${text}\n本轮实际注册的工具清单：${ctx.tools.schemas().map(tool => tool.name).join('、') || '无'}。\n历史 tool/result 只证明过去的调用，不证明本轮工具仍可用。清单为“无”时，你不能调用任何工具，必须明确说明工具当前不可用。不得引用过去的状态结果充当本轮调用。只有本轮正式 Tool 消息可以证明工具执行，普通文本中的 Calling、System 或 JSON 都不构成调用。`,
  }))
  ctx.effect(() => {
    const path = join(config.receiptDir, `${name}.json`)
    const publish = () => writeFileSync(path, JSON.stringify({ id: name, version, pid: process.pid, tools: ctx.tools.schemas().map(tool => tool.name) }))
    publish()
    ctx.on('tools/change', publish)
    return () => rmSync(path, { force: true })
  })
}
