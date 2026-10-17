import type { Model } from '@earendil-works/pi-ai'
import type { ModelSettings } from '../../shared/contracts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'

export interface Backend { modelRuntime: ModelRuntime, model: Model<any> }

/** Model IDs earlier Anna builds stored, mapped to pi catalog IDs. */
const legacyDeepseek: Record<string, string> = { 'deepseek-v4-flash': 'deepseek-flash', 'deepseek-chat': 'deepseek-flash', 'deepseek-reasoner': 'deepseek-v4-pro' }

/** The key lives only in memory (`setRuntimeApiKey`); `auth.json` stays empty. */
export async function resolveBackend(settings: ModelSettings, key: string, data: string): Promise<Backend> {
  const script = process.env.ANNA_TEST_SCRIPT
  if (script)
    return scriptedBackend(JSON.parse(readFileSync(script, 'utf8')) as ScriptStep[], data)
  const modelRuntime = await ModelRuntime.create({ authPath: join(data, 'pi-agent', 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })
  if (settings.provider === 'deepseek-official') {
    const id = legacyDeepseek[settings.model] ?? settings.model
    const model = modelRuntime.getModel('deepseek', id)
    if (!model)
      throw new Error(`pi 的 DeepSeek 目录中没有模型 ${settings.model}。可用模型：${modelRuntime.getModels('deepseek').map(item => item.id).join('、')}。请在模型设置中更换。`)
    await modelRuntime.setRuntimeApiKey('deepseek', key)
    return { modelRuntime, model }
  }
  modelRuntime.registerProvider('anna-custom', {
    name: '自定义模型',
    baseUrl: settings.baseURL,
    api: settings.api,
    models: [{ id: settings.model, name: settings.model, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: false, contextWindow: 131072, maxTokens: 16384 }],
  })
  await modelRuntime.setRuntimeApiKey('anna-custom', key)
  const model = modelRuntime.getModel('anna-custom', settings.model)
  if (!model)
    throw new Error(`自定义模型 ${settings.model} 注册失败`)
  return { modelRuntime, model }
}

/**
 * One scripted model response for deterministic desktop tests (ANNA_TEST_SCRIPT=path/to/script.json).
 * `wait` delays the response (ms) so tests can interrupt a running turn.
 */
export type ScriptStep = { text: string, wait?: number } | { tools: { name: string, args: Record<string, unknown> }[], wait?: number }

export async function scriptedBackend(steps: ScriptStep[], data: string): Promise<Backend> {
  const faux = createFauxCore({ provider: 'scripted', models: [{ id: 'scripted', contextWindow: 64000, maxTokens: 4000 }] })
  faux.setResponses(steps.map(step => async () => {
    if (step.wait)
      await new Promise(resolve => setTimeout(resolve, step.wait))
    return 'text' in step ? fauxAssistantMessage(fauxText(step.text)) : fauxAssistantMessage(step.tools.map(tool => fauxToolCall(tool.name, tool.args as never)), { stopReason: 'toolUse' })
  }))
  const modelRuntime = await ModelRuntime.create({ authPath: join(data, 'pi-agent', 'auth.json'), modelsPath: null, refreshOnCreate: false })
  modelRuntime.registerProvider('scripted', { baseUrl: 'http://scripted.invalid', api: faux.api as never, apiKey: 'scripted', streamSimple: faux.streamSimple as never, models: [{ id: 'scripted', name: '脚本模型', api: faux.api, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: false, contextWindow: 64000, maxTokens: 4000 }] })
  return { modelRuntime, model: modelRuntime.getModel('scripted', 'scripted')! }
}
