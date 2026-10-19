/** The online demo's view of the runtime: what a visitor sees differs from the server's own paths. */

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The snapshot or event with the visitor's workspace shown as `workspace` (also its `/private` twin on macOS). Rules
 * are left as they are, since removing one has to name it exactly. The commands that run are not touched.
 */
export function shortPaths<T>(value: T, root: string): T {
  if (!root)
    return value
  const bare = root.replace(/^\/private(?=\/)/, '')
  const pattern = new RegExp(`(?:/private)?${escape(bare)}(?![\\w.-])`, 'g')
  const walk = (node: unknown, key?: string): unknown => {
    if (typeof node === 'string')
      return node.replace(pattern, 'workspace')
    if (key === 'rules' || !node || typeof node !== 'object')
      return node
    if (Array.isArray(node))
      return node.map(item => walk(item))
    return Object.fromEntries(Object.entries(node).map(([name, item]) => [name, walk(item, name)]))
  }
  return walk(value) as T
}

/** Opening prompts for a visitor: what sets Anna apart first (delegation, shared memory), a bug fix last. */
export function tourPrompts() {
  return [
    '@claude 把这周的复习安排排进 plan.md，周三下午留给实验课',
    '记住：我每周三下午有实验课，复习时喜欢番茄钟',
    '跑一下测试，看看哪里坏了，然后修好它',
  ]
}

/** The tour card: what the demo shows, and what only the desktop app does (said as such). */
export const tour = {
  online: [
    { title: '派活，再验收', body: '输入 @claude 或 @codex，把活交给 Claude Code、Codex。它们做完，伙伴会亲自核对改动，再告诉你能不能放心用。' },
    { title: '一处管好所有 agent 的服务商', body: '这里的 Claude Code 和 Codex 都通过 Anna 的本地路由跑在魔搭 Qwen 上；一个模型的额度用完，会自动换下一个。' },
    { title: '一本共同的日记', body: '五位伙伴、三种大脑共用记忆，每条都写明是谁记的。说一句「记住：…」，再换一位伙伴，或在“模型与设置”里把大脑换成 Claude Code，问问看。' },
  ],
  desktop: [
    { title: '微信 ClawBot', body: '在手机微信里给 Anna 派活，她在电脑上做完，把结果发回微信。' },
    { title: 'cc-switch', body: '找到你电脑上的 Claude Code、Codex 等 coding agent，内置服务商预设，一键切换。' },
    { title: '全局路由', body: '你在终端里用的 Claude Code、Codex 也走 Anna 的路由和备用服务商。' },
  ],
}
