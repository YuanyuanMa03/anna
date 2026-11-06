import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as v from 'valibot'
import { describe, expect, it, vi } from 'vitest'
import { AgentsHub } from '../packages/anna-host/agents-hub'
import { SettingsStore } from '../packages/anna-host/settings'
import { defaultProfile, personalityCards, personalityInstructions, profileSchema } from '../packages/character/personality'

async function setup() {
  const data = await mkdtemp(join(tmpdir(), 'anna-life-'))
  const store = new SettingsStore(data)
  await store.load()
  let secrets = ''
  const hub = new AgentsHub(data, store, { read: async () => secrets, write: async (value) => { secrets = value } })
  return { data, store, hub }
}

describe('sharing pi models', () => {
  it('routes a Chat model to both supported brains, persists the original selections, and restores them after restart', async () => {
    const { data, store, hub } = await setup()
    await hub.setProvider('claude', 'Claude Official')
    await hub.sharePiModel('private-test-key', false)
    expect(store.value.agents?.claude?.provider).toBe('Anna · pi 共用模型')
    expect(store.value.agents?.codex?.provider).toBe('Anna · pi 共用模型')
    expect((await hub.choice('claude'))?.preset.apiFormat).toBe('openai_chat')
    expect((await hub.choice('codex'))?.key).toBe('private-test-key')
    await hub.sharePiModel('private-test-key', false)
    expect(store.value.sharedModelBackup?.claude?.provider).toBe('Claude Official')
    const serialized = await readFile(join(data, 'settings.json'), 'utf8')
    expect(serialized).not.toContain('private-test-key')
    await store.load()
    await hub.sharePiModel('', true)
    expect(store.value.agents?.claude?.provider).toBe('Claude Official')
    expect(store.value.agents?.codex?.provider).toBeUndefined()
    expect(store.value.sharedModelBackup).toBeUndefined()
  })
  it.each(['anthropic-messages', 'openai-responses'] as const)('only selects compatible brains for %s', async (api) => {
    const { store, hub } = await setup()
    store.value.model.api = api
    await hub.sharePiModel('key', false)
    const target = api === 'anthropic-messages' ? 'claude' : 'codex'
    const other = target === 'claude' ? 'codex' : 'claude'
    expect(store.value.agents?.[target]?.provider).toBe('Anna · pi 共用模型')
    expect(store.value.agents?.[other]?.provider).toBeUndefined()
    await hub.sharePiModel('', true)
    expect(store.value.agents?.[target]?.provider).toBeUndefined()
  })
  it('refuses sharing without a pi credential, preserving existing choices', async () => {
    const { store, hub } = await setup()
    await expect(hub.sharePiModel('', false)).rejects.toThrow('密钥')
    expect(store.value.sharedModelBackup).toBeUndefined()
  })
})

it('validates, saves and reloads the personality profile and includes it in instructions', async () => {
  const { store } = await setup()
  store.value.personality = { ...defaultProfile(), nickname: '朋友', tone: 'curious', type: 'ENTP' }
  await store.save()
  await store.load()
  expect(personalityInstructions(store.value.personality)).toContain('好奇探索者')
  expect(personalityInstructions(store.value.personality)).toContain('朋友')
  expect(() => v.parse(profileSchema, { ...defaultProfile(), tone: 'invalid' })).toThrow()
  expect(() => v.parse(profileSchema, { ...defaultProfile(), nickname: 'x'.repeat(41) })).toThrow()
})

it('has sixteen distinct personality cards with both previews', () => {
  expect(new Set(personalityCards.map(card => card.id)).size).toBe(16)
  for (const card of personalityCards) {
    expect(card.work).toBeTruthy()
    expect(card.company).toBeTruthy()
    expect(personalityInstructions({ ...defaultProfile(), type: card.id })).toContain(card.code)
  }
})

it('migrates old four-tone profiles without dropping the nickname', async () => {
  const { store } = await setup()
  store.value.personality = { nickname: '朋友', tone: 'curious', purpose: 'work', detail: 'brief' }
  await store.save()
  await store.load()
  expect(store.value.personality?.type).toBe('ENTP')
  expect(store.value.personality?.nickname).toBe('朋友')
})

it('follows pi updates but preserves manual opt-outs on restore and restart', async () => {
  const { hub, store } = await setup()
  await hub.sharePiModel('first', false)
  await hub.setProvider('claude', 'Claude Official')
  store.value.model.model = 'second-model'
  await hub.sharePiModel('second', false, true)
  expect(store.value.agents?.claude?.provider).toBe('Claude Official')
  expect((await hub.choice('codex'))?.preset.model).toBe('second-model')
  await store.load()
  await hub.sharePiModel('', true)
  expect(store.value.agents?.claude?.provider).toBe('Claude Official')
  expect(store.value.agents?.codex?.provider).toBeUndefined()
})

it('rolls back both selections and credentials when persistence fails', async () => {
  const { hub, store } = await setup()
  await hub.sharePiModel('first', false)
  const before = structuredClone(store.value)
  const save = vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('disk full'))
  await expect(hub.sharePiModel('second', false)).rejects.toThrow('disk full')
  expect(store.value).toEqual(before)
  expect((await hub.choice('codex'))?.key).toBe('first')
  save.mockRestore()
  await store.load()
  expect(store.value).toEqual(before)
})

it('restores an incompatible follower when pi changes protocol', async () => {
  const { hub, store } = await setup()
  await hub.sharePiModel('first', false)
  store.value.model.api = 'anthropic-messages'
  await hub.sharePiModel('second', false, true)
  expect(store.value.agents?.codex?.provider).toBeUndefined()
  expect(store.value.agents?.claude?.provider).toBe('Anna · pi 共用模型')
  store.value.model.api = 'openai-completions'
  await hub.sharePiModel('third', false, true)
  expect(store.value.agents?.codex?.provider).toBe('Anna · pi 共用模型')
})

it('preserves the last quota on network failure and labels it stale', async () => {
  const { store, data } = await setup()
  let fail = false
  const hub = new AgentsHub(data, store, { read: async () => '', write: async () => {} }, {
    fetch: async () => {
      if (fail)
        throw new Error('offline')
      return new Response(JSON.stringify({ balance_infos: [{ currency: 'CNY', total_balance: '12.5' }] }))
    },
  })
  await hub.checkPiUsage('test-key')
  const before = (await hub.snapshot()).usage['pi:current']!
  fail = true
  await hub.checkPiUsage('test-key')
  const after = (await hub.snapshot()).usage['pi:current']!
  expect(after.balances).toEqual(before.balances)
  expect(after.at).toBe(before.at)
  expect(after.stale).toBe(true)
  expect(after.error).toBeTruthy()
})

it('preserves manual edits and renames of a generated shared provider', async () => {
  const { hub, store } = await setup()
  await hub.sharePiModel('key', false)
  await hub.saveProvider({ app: 'claude', previous: 'Anna · pi 共用模型', name: 'My edited provider', model: 'my-model' })
  store.value.model.model = 'new-pi-model'
  await hub.sharePiModel('key', false, true)
  expect(store.value.agents?.claude?.provider).toBe('My edited provider')
  expect((await hub.choice('claude'))?.preset.env?.ANTHROPIC_MODEL).toBe('my-model')
  await hub.sharePiModel('', true)
  expect(store.value.agents?.claude?.provider).toBe('My edited provider')
})

it('keeps the first selection backup when a user opts out then explicitly shares again', async () => {
  const { hub, store } = await setup()
  await hub.setProvider('claude', 'Claude Official')
  await hub.sharePiModel('key', false)
  await hub.setProvider('claude')
  await hub.sharePiModel('key', false)
  expect(store.value.sharedModelBackup?.claude?.provider).toBe('Claude Official')
  await hub.sharePiModel('', true)
  expect(store.value.agents?.claude?.provider).toBe('Claude Official')
})

it('recovers a shared-model transaction interrupted after settings persisted but before commit', async () => {
  const { data, store } = await setup()
  let raw = ''
  let pending = ''
  const vault = { read: async () => raw, write: async (value: string) => {
    raw = value; if (value.includes('anna:shared-model-transaction'))
      pending = value
  } }
  const hub = new AgentsHub(data, store, vault)
  await hub.setProvider('claude', 'Claude Official')
  const previous = structuredClone(store.value)
  await hub.sharePiModel('private-transaction-key', false)
  expect(store.value.agents?.claude?.provider).toBe('Anna · pi 共用模型')
  // Simulate the persisted vault snapshot at the crash boundary; credentials stay inside the vault interface.
  raw = pending
  const restartedStore = new SettingsStore(data)
  await restartedStore.load()
  const restarted = new AgentsHub(data, restartedStore, vault)
  await restarted.recoverSharedModel()
  expect(restartedStore.value).toEqual(previous)
  expect(raw).not.toContain('anna:shared-model-transaction')
  expect(raw).not.toContain('private-transaction-key')
  expect(await readFile(join(data, 'settings.json'), 'utf8')).not.toContain('private-transaction-key')
})

it('applies the default INFJ style before an existing user chooses a personality', () => {
  expect(personalityInstructions()).toContain('温柔同行者（INFJ）')
  expect(personalityInstructions()).toContain('诚实、事实判断和权限边界始终不变')
})
