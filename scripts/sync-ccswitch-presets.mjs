import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

/**
 * Regenerate packages/agents/presets.json from a cc-switch checkout (https://github.com/farion1231/cc-switch, MIT).
 * Usage: node scripts/sync-ccswitch-presets.mjs /path/to/cc-switch
 * Only connection fields are kept. Claude Code and Codex presets in Chat Completions format go through Anna's own
 * local routing (packages/routing); other presets that need cc-switch's format-converting proxy are skipped.
 */
const source = resolve(process.argv[2] ?? '')
if (!process.argv[2])
  throw new Error('usage: node scripts/sync-ccswitch-presets.mjs <cc-switch checkout>')
const commit = execFileSync('git', ['-C', source, 'rev-parse', '--short', 'HEAD']).toString().trim()
const out = await mkdtemp(join(tmpdir(), 'anna-presets-'))

async function load(file) {
  const outfile = join(out, `${file}.mjs`)
  await build({ entryPoints: [join(source, 'src/config', `${file}.ts`)], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', alias: { '@': join(source, 'src') } })
  return import(pathToFileURL(outfile).href)
}

/** Drop referral/tracking parameters: Anna shows plain provider links. */
function plain(url) {
  if (!url)
    return url
  try {
    const parsed = new URL(url)
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:aff|affiliate|ref|referral|invite|track_id|utm_\w+|from|source|channel|code|inviteCode|invite_code|ic|ch|ytag|ac|rc)$/i.test(key))
        parsed.searchParams.delete(key)
    }
    return parsed.toString().replace(/\?$/, '')
  }
  catch { return url }
}
const pick = (preset, extra) => ({ name: preset.name, website: plain(preset.websiteUrl), apiKeyUrl: plain(preset.apiKeyUrl), official: Boolean(preset.isOfficial), category: preset.category ?? 'third_party', ...extra, ...(preset.endpointCandidates?.length ? { endpoints: preset.endpointCandidates } : {}) })
/**
 * The protocols Anna can serve per app: each app's native one, plus Chat Completions through Anna's routing.
 * For Codex, `openai_responses` (`responses` in older cc-switch) is native.
 */
const native = { claude: ['anthropic', 'openai_chat'], codex: ['openai_responses', 'responses', 'openai_chat'] }
const proxyOnly = (app, value) => typeof value === 'string' && !native[app].includes(value)

const claude = (await load('claudeProviderPresets')).providerPresets.filter(preset => !proxyOnly('claude', preset.apiFormat) && !preset.requiresOAuth && !preset.hidden).filter(preset => !Object.keys(preset.settingsConfig?.env ?? {}).some(key => key.startsWith('AWS_') || key.startsWith('CLAUDE_CODE_USE_'))).map(preset => pick(preset, { keyField: preset.apiKeyField ?? 'ANTHROPIC_AUTH_TOKEN', ...(preset.apiFormat === 'openai_chat' ? { apiFormat: 'openai_chat' } : {}), env: Object.fromEntries(Object.entries(preset.settingsConfig?.env ?? {}).filter(([key, value]) => key !== 'ANTHROPIC_AUTH_TOKEN' && key !== 'ANTHROPIC_API_KEY' && typeof value === 'string' && value)) }))

/** cc-switch's per-preset Codex model rows (name, window, modalities, reasoning levels), undefined fields dropped. */
function catalogRows(rows) {
  return rows?.length ? rows.map(row => JSON.parse(JSON.stringify(row))) : undefined
}

function tomlValue(text, key) {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(text)
  return match?.[1]
}
const codex = (await load('codexProviderPresets')).codexProviderPresets.filter(preset => !proxyOnly('codex', preset.apiFormat) && !preset.requiresOAuth && !preset.hidden && !preset.isCustomTemplate).map(preset => pick(preset, { baseUrl: tomlValue(preset.config ?? '', 'base_url'), model: tomlValue(preset.config ?? '', 'model'), wireApi: tomlValue(preset.config ?? '', 'wire_api') ?? 'responses', ...(preset.apiFormat === 'openai_chat' ? { apiFormat: 'openai_chat', chatReasoning: preset.codexChatReasoning } : {}), models: catalogRows(preset.modelCatalog) })).filter(preset => preset.official || preset.baseUrl)

const gemini = (await load('geminiProviderPresets')).geminiProviderPresets.filter(preset => !preset.hidden).map(preset => pick(preset, { env: Object.fromEntries(Object.entries(preset.settingsConfig?.env ?? {}).filter(([key, value]) => !/KEY|TOKEN/.test(key) && typeof value === 'string' && value)) }))

const data = { source: { repo: 'https://github.com/farion1231/cc-switch', commit, license: 'MIT', copyright: 'Jason Young' }, claude, codex, gemini }
await writeFile('packages/agents/presets.json', `${JSON.stringify(data, null, 2)}\n`)
// The templates Codex model catalogs are built from: cc-switch's neutral native-Responses entry, DeepSeek's official
// Codex catalog (the file DeepSeek's own integration script writes) and Codex's classic GPT entry, whose freeform
// apply_patch the routing turns into a plain function for Chat providers.
await mkdir('packages/agents/codex-catalog', { recursive: true })
for (const [from, to] of [['codex_native_responses_template.json', 'native-responses.json'], ['codex_deepseek_catalog_template.json', 'deepseek.json'], ['gpt5_5_template.json', 'classic-tools.json']])
  await writeFile(join('packages/agents/codex-catalog', to), `${JSON.stringify(JSON.parse(await readFile(join(source, 'src-tauri/src/resources', from), 'utf8')), null, 2)}\n`)
console.log(`claude ${claude.length}, codex ${codex.length}, gemini ${gemini.length} presets from cc-switch ${commit}`)
