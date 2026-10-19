import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { defaultSettings } from '../../packages/anna-host/settings'

/** The provider name visitors see for Claude Code and Codex. */
export const relayProvider = 'ModelScope 免费推理'

export interface SeedOptions {
  /** Base of the server's inference relay, e.g. http://127.0.0.1:7870/v1. */
  relay: string
  /** Anna's own model (pi). */
  model: string
  /** The model Claude Code and Codex use. */
  agentModel: string
}

const demoProject: Record<string, string> = {
  'README.md': `# 复习计划小工具（示例项目）

这是 Anna 在线体验为你准备的示例项目，是手工构造的演示代码，不是真实数据。你可以随意让 Anna 修改它，改坏了也能在交付卡里一键撤销。

它做一件事：把要复习的章节平均分到接下来几天。

## 可以试试

- “看看这个项目，给我一个概览”
- “跑一下测试，看看哪里坏了，然后修好它”
- “找出项目里的 TODO，整理成清单”
- “@codex 给 planner 加一个按难度排序的功能”（交给 Codex 去做，Anna 会检查它的改动）
- “记住：我每周三下午有实验课”，然后换一位伙伴问问他记不记得

## 运行

\`\`\`sh
npm test
node src/cli.js 高数第三章 高数第四章 线代第一章 英语阅读 3
\`\`\`
`,
  'package.json': `${JSON.stringify({ name: 'study-planner', version: '0.1.0', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
  'src/planner.js': `/**
 * 把章节平均分到若干天。
 * @param {string[]} chapters 要复习的章节
 * @param {number} days 天数
 * @returns {string[][]} 每天的章节
 */
export function plan(chapters, days) {
  if (days < 1)
    throw new Error('天数至少是 1')
  const perDay = Math.ceil(chapters.length / days)
  const result = []
  // 这里有个 bug：最后一天的章节会被漏掉
  for (let day = 0; day < days - 1; day++)
    result.push(chapters.slice(day * perDay, (day + 1) * perDay))
  return result
}

// TODO: 支持按难度给章节排序，难的放在前几天
// TODO: 周末可以多排一点
`,
  'src/cli.js': `import { plan } from './planner.js'

const args = process.argv.slice(2)
const days = Number(args.pop())
const chapters = args
// TODO: 参数不对时给出友好的用法提示
plan(chapters, days).forEach((items, index) => console.log(\`第 \${index + 1} 天：\${items.join('、') || '休息'}\`))
`,
  'test/planner.test.js': `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { plan } from '../src/planner.js'

test('每一章都被排进计划', () => {
  const chapters = ['第一章', '第二章', '第三章', '第四章', '第五章']
  assert.deepEqual(plan(chapters, 2).flat(), chapters)
})

test('天数和计划长度一致', () => {
  assert.equal(plan(['a', 'b', 'c'], 3).length, 3)
})
`,
  'notes/本周安排.md': `# 本周安排（示例）

- 周一：高数
- 周三下午：实验课
- 周五：英语阅读
`,
}

/**
 * A new visitor's data directory: settings that point Anna, Claude Code and Codex at the relay, and a small demo
 * project in the default workspace. The project is constructed demo input, labelled as such in its README.
 */
export async function seedVisitor(data: string, { relay, model, agentModel }: SeedOptions) {
  const workspace = join(data, 'workspace')
  await mkdir(workspace, { recursive: true, mode: 0o700 })
  const claude = { name: relayProvider, official: false, category: 'aggregator', keyField: 'ANTHROPIC_AUTH_TOKEN', apiFormat: 'openai_chat', env: { ANTHROPIC_BASE_URL: relay, ANTHROPIC_MODEL: agentModel, ANTHROPIC_DEFAULT_HAIKU_MODEL: agentModel, ANTHROPIC_DEFAULT_SONNET_MODEL: agentModel, ANTHROPIC_DEFAULT_OPUS_MODEL: agentModel } }
  const codex = { name: relayProvider, official: false, category: 'aggregator', baseUrl: relay, model: agentModel, wireApi: 'responses', apiFormat: 'openai_chat', chatReasoning: { supportsThinking: true, supportsEffort: false, thinkingParam: 'enable_thinking', effortParam: 'none', outputFormat: 'reasoning_content' }, models: [{ model: agentModel, displayName: agentModel, contextWindow: 200000 }] }
  const settings = {
    ...defaultSettings(),
    model: { provider: 'custom', model, baseURL: relay, api: 'openai-completions' },
    modelVerified: true,
    providers: [{ app: 'claude', name: relayProvider, source: 'custom', preset: claude }, { app: 'codex', name: relayProvider, source: 'custom', preset: codex }],
    agents: { claude: { provider: relayProvider }, codex: { provider: relayProvider } },
  }
  await writeFile(join(data, 'settings.json'), JSON.stringify(settings), { mode: 0o600 })
  for (const [path, content] of Object.entries(demoProject)) {
    await mkdir(dirname(join(workspace, path)), { recursive: true })
    await writeFile(join(workspace, path), content)
  }
  // A git history lets Anna and the agents check changes with `git diff`. Without git the demo still works.
  const git = (...args: string[]) => promisify(execFile)('git', ['-c', 'user.name=Anna', '-c', 'user.email=anna@example.invalid', ...args], { cwd: workspace })
  await git('init', '-q', '-b', 'main').then(() => git('add', '-A')).then(() => git('commit', '-q', '-m', '示例项目')).catch(() => {})
}

/** The keys Claude Code and Codex use for the relay provider: the visitor's relay token. */
export const providerKeys = (token: string) => JSON.stringify({ [`claude:${relayProvider}`]: token, [`codex:${relayProvider}`]: token })
