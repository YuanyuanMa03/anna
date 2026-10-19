import { relayProvider } from './seed'

/**
 * What a browser may ask a visitor's Anna to do. Everything a desktop user can do inside Anna is here, except what
 * reaches outside the visitor's sandboxed home: picking folders on the server, WeChat, updates, installing agents,
 * import/export files, providers with arbitrary endpoints (the Studio would make requests on a visitor's behalf), and
 * global routing, backups and routing policies (the routing server's port is shared by every visitor, and the relay is
 * the only provider there is to route to).
 */
const allowed = new Set(['snapshot', 'send', 'connect', 'restart', 'stop', 'new-session', 'character', 'plugin', 'trust', 'mode', 'approval', 'rule-remove', 'changes', 'undo', 'memory', 'memory-forget', 'review', 'agents-refresh', 'agent-provider', 'kernel'])
const desktopOnly: Record<string, string> = {
  'configure': '在线体验的模型由服务端统一接到 ModelScope 免费推理，无需填写密钥。',
  'workspace': '在线体验使用你自己的独立工作区。',
  'choose-workspace': '在线体验使用你自己的独立工作区。',
  'weixin-login': '微信远程派活需要桌面版。',
  'weixin-status': '微信远程派活需要桌面版。',
  'agent-install': '在线体验已经装好了 Claude Code 和 Codex。',
}

export function validateCommand(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string')
    throw new Error('无效的请求。')
  const c = value as Record<string, unknown>
  const type = String(c.type)
  if (!allowed.has(type))
    throw new Error(desktopOnly[type] ?? '这项功能需要桌面版：服务商管理、导入导出、微信和更新只在你自己的电脑上开放。')
  if (type === 'send' && (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 12000))
    throw new Error('请输入 1–12000 字的消息。')
  if (type === 'mode' && !['plan', 'ask', 'edit', 'auto'].includes(String(c.mode)))
    throw new Error('未知权限模式。')
  if (type === 'kernel' && !['pi', 'claude-code', 'codex'].includes(String(c.id)))
    throw new Error('未知的大脑。')
  if (['plugin', 'memory', 'review', 'trust'].includes(type) && typeof (type === 'trust' ? c.trusted : c.enabled) !== 'boolean')
    throw new Error('无效的开关。')
  for (const field of ['id', 'rule', 'taskId', 'agent', 'provider', 'app']) {
    if (c[field] !== undefined && (typeof c[field] !== 'string' || String(c[field]).length > 1000))
      throw new Error('无效的参数。')
  }
  if (type === 'agent-provider' && c.key !== undefined)
    throw new Error('在线体验里不能填写服务商密钥；请在桌面版使用自己的服务商。')
  // Claude Code and Codex reach only the demo's relay; any other provider would send requests from the Studio.
  if (type === 'agent-provider' && c.provider !== undefined && c.provider !== relayProvider)
    throw new Error('在线体验里 Claude Code 和 Codex 只能用魔搭免费推理；换服务商、全局路由和备用服务商请用桌面版。')
  if (type === 'approval' && (typeof c.allow !== 'boolean' || (c.scope !== undefined && !['once', 'session', 'always'].includes(String(c.scope)))))
    throw new Error('无效的确认。')
  return c
}
