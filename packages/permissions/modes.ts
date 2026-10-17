/**
 * Anna's permission modes, ordered from most to least supervised.
 * Each mode is a policy table (see engine.ts), a stance on the stage (packages/character/director.ts),
 * and a mapping onto other agent kernels so adapters can translate faithfully.
 *
 * Like Codex, a mode pairs what shell commands may touch (the sandbox: read-only for plan, workspace-write
 * otherwise) with when Anna asks (the approval policy). Like Claude Code, the file tools follow the same table and
 * allow/ask/deny rules adjust it. In every mode, reading secret files (`.env`, private keys) asks, risky commands and
 * edits outside the workspace ask one approval at a time, and Anna's own data stays unreachable.
 */
export type PermissionMode = 'plan' | 'ask' | 'edit' | 'auto'
export const modeOrder: PermissionMode[] = ['plan', 'ask', 'edit', 'auto']

export interface ModeInfo {
  label: string
  short: string
  description: string
  /** What Anna says when the user switches into this mode. */
  greeting: string
  /** Allowed only in workspaces the user trusts. */
  needsTrust: boolean
  claudeCode: 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions'
  /** Codex's closest approval policy and sandbox (`codex app-server` thread settings). */
  codex: { approval: 'untrusted' | 'on-request' | 'never', sandbox: 'read-only' | 'workspace-write' }
}

export const modes: Record<PermissionMode, ModeInfo> = {
  plan: {
    label: '规划',
    short: '只看不动',
    description: '只读：查看文件、搜索、运行只读命令，先给出方案，不修改任何东西。读取工作文件夹之外的内容会先问你。',
    greeting: '好，我先看清楚再说方案，这段时间不会动你的文件。',
    needsTrust: false,
    claudeCode: 'plan',
    codex: { approval: 'untrusted', sandbox: 'read-only' },
  },
  ask: {
    label: '谨慎',
    short: '每步都问',
    description: '每次修改文件或运行非只读命令前都先问你；读取工作文件夹之外的内容也会先问。',
    greeting: '明白，每次要动手之前我都会先问你。',
    needsTrust: false,
    claudeCode: 'default',
    codex: { approval: 'untrusted', sandbox: 'workspace-write' },
  },
  edit: {
    label: '协作',
    short: '改文件不问',
    description: '工作区内的修改和测试、构建直接进行；安装依赖、联网和其他命令先问你。',
    greeting: '好，工作区里的修改和测试我直接做，其他的再问你。',
    needsTrust: true,
    claudeCode: 'acceptEdits',
    codex: { approval: 'on-request', sandbox: 'workspace-write' },
  },
  auto: {
    label: '放手',
    short: '沙箱内全自动',
    description: '在沙箱里自主完成：命令只能写工作区，联网只自动放行常用软件源。高风险操作、工作区外的修改、读取 .env 和私钥这类密钥文件仍然会问你。',
    greeting: '交给我吧。我会在沙箱里放手去做，真正有风险的事还是会先问你。',
    needsTrust: true,
    claudeCode: 'bypassPermissions',
    codex: { approval: 'never', sandbox: 'workspace-write' },
  },
}

/** The stricter of two modes. Remote channels clamp to `ask`. */
export function stricter(a: PermissionMode, b: PermissionMode): PermissionMode {
  return modeOrder.indexOf(a) <= modeOrder.indexOf(b) ? a : b
}

/** Package registries the sandbox lets through without asking in `auto` mode. */
export const trustedRegistries = ['registry.npmjs.org', 'registry.yarnpkg.com', 'registry.npmmirror.com', 'pypi.org', 'files.pythonhosted.org', 'crates.io', 'static.crates.io', 'index.crates.io', 'proxy.golang.org', 'sum.golang.org', 'github.com', 'codeload.github.com', 'objects.githubusercontent.com', 'raw.githubusercontent.com']
