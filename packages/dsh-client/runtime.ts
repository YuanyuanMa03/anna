import type { HarnessNotification, HarnessSession } from '@deepseek-ai/dsh-sdk-client'
import type { ModelSettings } from '../shared/contracts'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

const require = createRequire(import.meta.url)
export interface RuntimeOptions {
  root: string
  data: string
  model: ModelSettings
  key: string
  statusEnabled: boolean
  sessionId?: string
}
/** Own one SDK subprocess. Profile replacement always follows confirmed SDK shutdown. */
export class Runtime {
  private harness?: DeepSeekHarness
  private session?: HarnessSession
  restored = false
  constructor(private options: RuntimeOptions) {}

  async start() {
    const { root, data, model, key, statusEnabled } = this.options
    const home = join(data, 'dsh-home')
    const profile = join(home, 'profiles', 'anna')
    const receipts = join(data, 'receipts')
    await mkdir(profile, { recursive: true, mode: 0o700 })
    await mkdir(join(data, 'workspace'), { recursive: true, mode: 0o700 })
    await rm(receipts, { recursive: true, force: true })
    await mkdir(receipts, { mode: 0o700 })
    await writeFile(join(profile, 'package.json'), await readFile(join(root, 'profiles/anna/package.json'), 'utf8'))
    const disabled = ['persistent-bash', 'persistent-pwsh', 'tool-fs', 'tool-working-directory']
    const insert = [
      { id: 'anna-persona', name: join(root, 'dist/host/plugins/anna-persona/index.js'), config: { promptPath: join(root, 'plugins/anna-persona/persona.md'), receiptDir: receipts } },
      ...(statusEnabled ? [{ id: 'anna-status', name: join(root, 'dist/host/plugins/anna-status/index.js'), config: { receiptDir: receipts, statePath: join(data, 'character.json'), packagePath: join(root, 'package.json'), runtimePackagePath: require.resolve('@deepseek-ai/dsh/package.json') } }] : []),
      ...(model.provider === 'custom' ? [{ id: 'anna-provider', name: require.resolve('@deepseek-ai/dsh-llm-pi-ai'), config: { providers: { 'anna-model': { api: model.api, baseURL: model.baseURL, apiKeyEnv: 'ANNA_MODEL_KEY', models: [{ id: model.model, input: ['text'], contextWindow: 131072, maxTokens: 8192 }], timeoutMs: 90000, streamIdleTimeoutMs: 90000, retryPolicy: { mode: 'normal', maxRetries: 0 } } } } }] : []),
    ]
    const patch = [
      ...disabled.map(id => ({ id, disabled: true })),
      { id: 'sandbox-policy', config: { mode: 'read-only', workspaceRoot: join(data, 'workspace') } },
      { id: 'system-prompt', config: { personaPrefix: '', includeHarnessIdentity: false, includeRuntimeContext: false } },
      { id: 'llm-deepseek', disabled: model.provider !== 'deepseek-official', config: { baseURL: model.baseURL } },
      { insert },
    ]
    await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify(patch, null, 2))
    const env: NodeJS.ProcessEnv = { HOME: process.env.HOME, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'zh_CN.UTF-8', ELECTRON_RUN_AS_NODE: '1', ANNA_MODEL_KEY: key, DEEPSEEK_API_KEY: key }
    this.harness = new DeepSeekHarness({ profile: 'anna', dshHome: home, processCwd: join(data, 'workspace'), cwd: join(data, 'workspace'), provider: model.provider === 'custom' ? 'anna-model' : 'deepseek-official', model: model.model, maxTokens: 4096, env, initializeTimeoutMs: 30000 })
    try {
      await this.harness.start()
      if (this.options.sessionId) {
        this.session = await this.harness.resumeSession(this.options.sessionId)
        this.restored = true
      }
      else {
        this.session = this.harness.session()
      }
      return await this.inspect()
    }
    catch (error) {
      await this.close()
      throw error
    }
  }

  get sessionId() { return this.session?.id }
  async inspect() {
    const dir = join(this.options.data, 'receipts')
    const receipts: { id: string, version: string, pid: number, tools?: string[] }[] = []
    for (const file of await readdir(dir)) receipts.push(JSON.parse(await readFile(join(dir, file), 'utf8')))
    const persona = receipts.find(receipt => receipt.id === 'anna-persona')
    if (!persona)
      throw new Error('Anna persona did not activate')
    const expected = this.options.statusEnabled
    if (receipts.some(receipt => receipt.id === 'anna-status') !== expected)
      throw new Error('Plugin composition does not match requested state')
    const tools = persona.tools ?? []
    if (tools.some(tool => tool !== 'anna_status') || tools.includes('anna_status') !== expected)
      throw new Error('Unexpected runtime tool registry')
    return { plugins: receipts.map(receipt => receipt.id), tools, pid: persona.pid }
  }

  async run(text: string, onNotification: (notification: HarnessNotification) => void) {
    if (!this.session)
      throw new Error('Runtime is not ready')
    return this.session.run(text, { onNotification })
  }

  async close() {
    if (this.harness)
      await this.harness.close()
    this.harness = undefined
    this.session = undefined
  }
}
