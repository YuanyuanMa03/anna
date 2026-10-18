import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexCatalog, rejectsWebSearch } from '../packages/agents/codex-catalog'
import { globalPlan } from '../packages/agents/global'
import { buildLaunch } from '../packages/agents/launch'
import { chatRouteOf, findPreset, providerLaunch } from '../packages/agents/providers'

const preset = (name: string) => findPreset('codex', name)!

describe('codex model catalog (ported from cc-switch)', () => {
  it('deepSeek: the official catalog entries, in the preset\'s order, with its reasoning levels', () => {
    const models = codexCatalog(preset('DeepSeek'))!.models
    expect(models.map(entry => entry.slug)).toEqual(['deepseek-flash', 'deepseek-v4-pro'])
    // Official entries keep DeepSeek's own harness (freeform apply_patch), unlike the neutral template.
    expect(models[0]).toMatchObject({ apply_patch_tool_type: 'freeform', context_window: 1048576, default_reasoning_level: 'high', input_modalities: ['text', 'image'] })
    expect((models[0]!.supported_reasoning_levels as { effort: string }[]).map(level => level.effort)).toEqual(['low', 'high', 'max'])
    expect(models[1]).toMatchObject({ display_name: 'DeepSeek V4 Pro', input_modalities: ['text'], supports_parallel_tool_calls: expect.any(Boolean), supports_reasoning_summaries: expect.any(Boolean) })
  })

  it('other native Responses providers: the neutral template, edits through the shell tool, rows override', () => {
    const models = codexCatalog(preset('Kimi'))!.models
    expect(models[0]).toMatchObject({ slug: 'kimi-k3', display_name: 'Kimi K3', context_window: 1048576, max_context_window: 1048576, shell_type: 'shell_command', visibility: 'list', priority: 1000, supports_parallel_tool_calls: true })
    expect(models[0]).not.toHaveProperty('apply_patch_tool_type')
    expect(typeof models[0]!.base_instructions).toBe('string')
  })

  it('the model in use is listed first, even one the preset does not declare', () => {
    expect(codexCatalog(preset('DeepSeek'), 'deepseek-v4-pro')!.models.map(entry => entry.slug)).toEqual(['deepseek-v4-pro', 'deepseek-flash'])
    const custom = codexCatalog(preset('Kimi'), 'kimi-k9-preview')!.models
    expect(custom[0]).toMatchObject({ slug: 'kimi-k9-preview', display_name: 'kimi-k9-preview', input_modalities: ['text', 'image'] })
    expect(codexCatalog(preset('OpenAI Official'))).toBeUndefined()
  })

  it('web_search is turned off only on gateways known to reject it', () => {
    expect(rejectsWebSearch('https://api.minimax.cn/v1')).toBe(true)
    expect(rejectsWebSearch('https://openrouter.ai/api/v1', 'z-ai/glm-5.3')).toBe(true)
    expect(rejectsWebSearch('https://api.deepseek.com', 'deepseek-flash')).toBe(false)
    expect(rejectsWebSearch('https://notminimax.io.example.com')).toBe(false)
  })

  it('per-run launch: the catalog goes to a temp file Codex is pointed at, written before start', () => {
    const launch = providerLaunch('codex', { preset: preset('DeepSeek'), key: 'k' })
    // The value is a TOML string: on Windows the path's backslashes come escaped.
    const path = JSON.parse(launch.args.find(arg => arg.startsWith('model_catalog_json='))!.slice('model_catalog_json='.length)) as string
    expect(JSON.parse(launch.files![path]!).models[0].slug).toBe('deepseek-flash')
    expect(launch.args).not.toContain('web_search="disabled"')
    expect(providerLaunch('codex', { preset: preset('MiniMax'), key: 'k' }).args).toContain('web_search="disabled"')
    expect(buildLaunch('codex', { cwd: '/w', prompt: 'x', mode: 'ask', denyPaths: [], provider: { preset: preset('DeepSeek'), key: 'k' } }).files).toEqual(launch.files)
  })

  it('global switch: writes anna-model-catalog.json next to config.toml and points at it; switching back drops the pointer', () => {
    const { writes } = globalPlan('codex', { 'config.toml': 'web_search = "live"\n' }, { preset: preset('MiniMax'), key: 'k' }, '/home/u/.codex')
    expect(writes['config.toml']).toContain(`model_catalog_json = ${JSON.stringify(join('/home/u/.codex', 'anna-model-catalog.json'))}`)
    expect(writes['config.toml']).toContain('web_search = "disabled"')
    expect(writes['config.toml']).not.toContain('web_search = "live"')
    expect(JSON.parse(writes['anna-model-catalog.json']!).models[0].slug).toBe('MiniMax-M3')
    const back = globalPlan('codex', { 'config.toml': writes['config.toml'] }, { preset: preset('OpenAI Official') }, '/home/u/.codex')
    expect(back.writes['config.toml']).not.toContain('model_catalog_json')
    // DeepSeek keeps the user's own web_search setting.
    expect(globalPlan('codex', { 'config.toml': 'web_search = "live"\n' }, { preset: preset('DeepSeek') }, '/d').writes['config.toml']).toContain('web_search = "live"')
  })
})

it('the bundled templates exist and parse (synced from cc-switch)', () => {
  for (const file of ['native-responses.json', 'deepseek.json']) {
    const path = `packages/agents/codex-catalog/${file}`
    expect(existsSync(path)).toBe(true)
    expect(() => JSON.parse(readFileSync(path, 'utf8'))).not.toThrow()
  }
})

describe('chat Completions providers, through Anna\'s local routing', () => {
  const route = { baseUrl: 'http://127.0.0.1:4567/codex/v1', token: 'anna-route-abc' }

  it('catalog: Codex\'s classic entry (the routing turns freeform apply_patch into a function), never `original` image detail', () => {
    const models = codexCatalog(preset('OpenCode Go'))!.models
    expect(models[0]).toMatchObject({ slug: 'glm-5.3', display_name: 'GLM 5.3', context_window: 1000000, apply_patch_tool_type: 'freeform', supports_image_detail_original: false, supports_search_tool: false, input_modalities: ['text'], service_tiers: [], availability_nux: null, default_reasoning_level: 'high' })
    expect((models[0]!.supported_reasoning_levels as { effort: string }[]).map(level => level.effort)).toEqual(['low', 'high', 'max'])
    expect(codexCatalog(preset('PPIO'), 'some-model')!.models[0]).toMatchObject({ slug: 'some-model', context_window: 128000 })
  })

  it('launch: Codex gets the route and its token, never the real key; web_search stays Codex\'s own', () => {
    const minimax = preset('SiliconFlow en')
    expect(minimax.apiFormat).toBe('openai_chat')
    expect(() => providerLaunch('codex', { preset: minimax, key: 'sk-real' })).toThrow('local routing')
    const launch = providerLaunch('codex', { preset: minimax, key: 'sk-real' }, route)
    expect(launch.args).toContain(`model_providers.anna.base_url="${route.baseUrl}"`)
    expect(launch.args).toContain('model_providers.anna.wire_api="responses"')
    expect(launch.env).toEqual({ ANNA_PROVIDER_KEY: route.token })
    expect(JSON.stringify(launch)).not.toContain('sk-real')
    expect(launch.args).not.toContain('web_search="disabled"')
    expect(buildLaunch('codex', { cwd: '/w', prompt: 'x', mode: 'ask', denyPaths: [], provider: { preset: minimax, key: 'sk-real' }, route }).env).toEqual({ ANNA_PROVIDER_KEY: route.token })
  })

  it('the route carries the real key, reasoning settings and per-model levels', () => {
    expect(chatRouteOf({ preset: preset('OpenCode Go'), key: 'sk-real' })).toMatchObject({ baseUrl: 'https://opencode.ai/zen/go/v1', key: 'sk-real', reasoning: { effortValueMode: 'zen' }, effortLevels: { 'glm-5.3': ['low', 'high', 'max'], 'kimi-k3': ['max'] } })
  })

  it('global switch: refused for now (global routing comes later)', () => {
    expect(() => globalPlan('codex', { 'config.toml': '' }, { preset: preset('PPIO'), key: 'k' }, '/home/u/.codex')).toThrow('本地路由')
  })
})
