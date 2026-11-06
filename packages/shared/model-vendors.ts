import type { ModelSettings } from './contracts'

/**
 * Model vendors offered as tiles when pi's model is set up. Endpoints, key pages and model IDs follow cc-switch's
 * presets (MIT, https://github.com/farion1231/cc-switch, as in `packages/agents/presets.json`), using each vendor's
 * Chat Completions address, which pi speaks to every one of them. `models` only seeds the picker: the list the vendor
 * returns for the user's key wins.
 */
export interface ModelVendor {
  id: string
  label: string
  /** One line under the name: what the vendor is, or which key it takes. */
  hint: string
  api: ModelSettings['api']
  baseURL: string
  /** Where the user creates a key. */
  keyPage: string
  /** A server on this computer: no key, and the address can be edited (each tool uses its own port). */
  keyless?: boolean
  models: string[]
}

export const modelVendors: readonly ModelVendor[] = [
  { id: 'deepseek', label: 'DeepSeek', hint: '深度求索', api: 'openai-completions', baseURL: 'https://api.deepseek.com', keyPage: 'https://platform.deepseek.com/api_keys', models: ['deepseek-flash', 'deepseek-v4-pro'] },
  { id: 'kimi', label: 'Kimi', hint: '月之暗面', api: 'openai-completions', baseURL: 'https://api.moonshot.cn/v1', keyPage: 'https://platform.kimi.com/console/api-keys', models: ['kimi-k3', 'kimi-k2.7-code'] },
  { id: 'zhipu', label: '智谱 GLM', hint: '智谱开放平台', api: 'openai-completions', baseURL: 'https://open.bigmodel.cn/api/paas/v4', keyPage: 'https://open.bigmodel.cn/usercenter/apikeys', models: ['glm-5.3', 'glm-5.3-flash'] },
  { id: 'qwen', label: '通义千问', hint: '阿里云百炼', api: 'openai-completions', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyPage: 'https://platform.qianwenai.com/home/api-keys', models: ['qwen3.8-max', 'qwen3.8-27b'] },
  { id: 'mimo', label: '小米 MiMo', hint: '按量付费 · sk- 开头的 key', api: 'openai-completions', baseURL: 'https://api.xiaomimimo.com/v1', keyPage: 'https://platform.xiaomimimo.com/#/console/api-keys', models: ['mimo-v2.6-pro', 'mimo-v2.6-flash'] },
  { id: 'mimo-token-plan', label: '小米 MiMo Token Plan', hint: '套餐 · tp- 开头的 key', api: 'openai-completions', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', keyPage: 'https://platform.xiaomimimo.com/#/console/plan-manage', models: ['mimo-v2.6-pro', 'mimo-v2.6-flash'] },
  { id: 'minimax', label: 'MiniMax', hint: '稀宇科技', api: 'openai-completions', baseURL: 'https://api.minimax.cn/v1', keyPage: 'https://platform.minimax.cn/user-center/basic-information/interface-key', models: ['MiniMax-M3'] },
  { id: 'doubao', label: '豆包', hint: '火山方舟', api: 'openai-completions', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', keyPage: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', models: ['doubao-seed-2-1-pro-260628'] },
  { id: 'stepfun', label: '阶跃星辰', hint: 'StepFun', api: 'openai-completions', baseURL: 'https://api.stepfun.com/v1', keyPage: 'https://platform.stepfun.com/interface-key', models: ['step-3.7-flash'] },
  { id: 'siliconflow', label: '硅基流动', hint: '多家开源模型', api: 'openai-completions', baseURL: 'https://api.siliconflow.cn/v1', keyPage: 'https://cloud.siliconflow.cn/account/ak', models: ['deepseek-ai/DeepSeek-V4-Flash'] },
  { id: 'openrouter', label: 'OpenRouter', hint: '海外多家模型', api: 'openai-completions', baseURL: 'https://openrouter.ai/api/v1', keyPage: 'https://openrouter.ai/keys', models: [] },
  { id: 'openai', label: 'OpenAI', hint: 'GPT 系列', api: 'openai-responses', baseURL: 'https://api.openai.com/v1', keyPage: 'https://platform.openai.com/api-keys', models: [] },
  { id: 'anthropic', label: 'Anthropic', hint: 'Claude 系列', api: 'anthropic-messages', baseURL: 'https://api.anthropic.com', keyPage: 'https://console.anthropic.com/settings/keys', models: [] },
  { id: 'local', label: '本机模型', hint: 'OpenVINO / LM Studio / Ollama · 用本机 GPU、NPU', api: 'openai-completions', baseURL: 'http://127.0.0.1:11434/v1', keyPage: 'https://ollama.com/download', models: [], keyless: true },
  { id: 'gemini', label: 'Google Gemini', hint: 'Gemini 系列', api: 'openai-completions', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', keyPage: 'https://aistudio.google.com/apikey', models: [] },
]

const trimmed = (url: string) => url.replace(/\/+$/, '').toLowerCase()

/** A saved key may only go back to the address it was saved for: same host, same path, ignoring a trailing slash. */
export function sameEndpoint(a: string, b: string) {
  try {
    const [left, right] = [new URL(a), new URL(b)]
    return left.protocol === right.protocol && left.host === right.host && left.pathname.replace(/\/+$/, '') === right.pathname.replace(/\/+$/, '')
  }
  catch { return false }
}

/** A model server on this computer (loopback): the only place plain HTTP is allowed, and no key is needed. */
export function isLocalEndpoint(url: string) {
  try {
    const { protocol, hostname } = new URL(url)
    return (protocol === 'http:' || protocol === 'https:') && ['127.0.0.1', 'localhost', '[::1]'].includes(hostname)
  }
  catch { return false }
}

/** An address a model key may go to: HTTPS without credentials or a query, or a server on this computer. */
export function modelEndpointAllowed(url: string) {
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'https:' || isLocalEndpoint(url)) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
  }
  catch { return false }
}

/** The vendor a saved setting belongs to, or nothing for a custom endpoint. */
export function vendorFor(model: Pick<ModelSettings, 'provider' | 'baseURL' | 'api'>): ModelVendor | undefined {
  if (model.provider === 'deepseek-official')
    return modelVendors.find(vendor => vendor.id === 'deepseek')
  if (model.provider === 'custom' && model.api === 'openai-completions' && isLocalEndpoint(model.baseURL))
    return modelVendors.find(vendor => vendor.id === 'local')
  return modelVendors.find(vendor => vendor.id !== 'deepseek' && vendor.api === model.api && trimmed(vendor.baseURL) === trimmed(model.baseURL))
}

/** pi's setting for a vendor tile: DeepSeek stays on pi's own catalogue, every other vendor is a custom endpoint. */
export function vendorSettings(vendor: ModelVendor, model: string): ModelSettings {
  return { provider: vendor.id === 'deepseek' ? 'deepseek-official' : 'custom', model, baseURL: vendor.baseURL, api: vendor.api }
}

/** DeepSeek's models come from pi's own catalogue, which accepts only the IDs it knows; every other vendor lists its own. */
export const listsModels = (vendor: ModelVendor) => vendor.id !== 'deepseek'

/**
 * The model to show once a list arrives. What the user typed stays; so does a suggestion the key can use. An empty box,
 * or a suggestion the list lacks, becomes a suggestion the key can use. Without one the box is left empty for the user to
 * pick: the first model of an alphabetical list is rarely a chat model worth starting with.
 */
export function firstModel(current: string, listed: string[], suggested: string[]) {
  const id = current.trim()
  if (!listed.length || (id && (listed.includes(id) || !suggested.includes(id))))
    return current
  return suggested.find(item => listed.includes(item)) ?? ''
}
