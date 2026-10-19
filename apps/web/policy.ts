import type { KernelContext, ToolGate } from '../../packages/kernels/types'
import { canonical, isInside, resolveToolPath } from '../../packages/permissions/paths'

/** The public Studio has no shell, external agents, or access beyond this visitor's workspace. */
export function webGate(workspace: string, delegate: ToolGate): ToolGate {
  const root = canonical(workspace)
  return async (tool, input, id) => {
    if (['anna_memory', 'anna_status'].includes(tool))
      return delegate(tool, input, id)
    if (!['read', 'write', 'edit', 'grep', 'find', 'ls'].includes(tool))
      return { allow: false, reason: '在线体验只支持独立工作区内的文件操作、记忆和状态；终端及外部 agent 请使用桌面版。' }
    if (input.path !== undefined && typeof input.path !== 'string')
      return { allow: false, reason: '文件路径必须是字符串。' }
    const target = canonical(resolveToolPath(String(input.path ?? '.'), workspace))
    if (!isInside(root, target))
      return { allow: false, reason: '在线体验只能访问你自己的工作区。' }
    if (tool === 'write' && typeof input.content === 'string' && input.content.length > 100_000)
      return { allow: false, reason: '在线体验的单个文件最多 100 KB。' }
    return delegate(tool, input, id)
  }
}

export function webContext(context: KernelContext): KernelContext {
  return {
    ...context,
    trusted: false,
    allowedTools: ['read', 'write', 'edit', 'grep', 'find', 'ls', 'anna_memory', 'anna_status'],
    sandbox: undefined,
    gate: webGate(context.workspace, context.gate),
    tools: context.tools.filter(tool => ['anna_memory', 'anna_status'].includes(tool.name)),
    instructions: [...context.instructions, '## 在线体验环境\n这是 Anna 的 ModelScope 浏览器体验。每位访客有独立的工作区、记忆和会话。只允许工作区内的 read/write/edit/grep/find/ls 与 anna_memory、anna_status；终端、联网工具、微信、桌面设置和外部 agent 不可用。不要尝试调用它们。可以聊天、分析、写文档、编写代码文件并展示改动，但不能声称已运行代码或测试。不要把线上访客的文件当成真实观测数据。'],
  }
}
