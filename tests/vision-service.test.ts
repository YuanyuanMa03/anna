import type { VisionConfig } from '../packages/senses/contracts'
import { describe, expect, it, vi } from 'vitest'
import { validateVision, VisionService } from '../packages/senses/vision'

const config: VisionConfig = { baseURL: 'https://vision.example/v1', model: 'vision-test' }
const image = 'data:image/jpeg;base64,AQID'
const input = { type: 'vision-read' as const, id: 'read', image, question: '画面里是什么？', source: '测试图片' }
function setup(fetcher: typeof fetch = vi.fn()) {
  let saved = JSON.stringify({ config, key: 'private-vision-key' })
  return new VisionService({ read: async () => saved, write: async (value) => { saved = value } }, fetcher)
}
describe('one-shot vision service', () => {
  it('returns sourced observation, calls no tools and never exposes the saved key', async () => {
    const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: '画面里有一张表格。' } }] }))
    const service = setup(fetcher)
    expect(JSON.stringify(await service.execute({ type: 'vision-status' }))).not.toContain('private-vision-key')
    const result = await service.execute(input)
    expect(result).toMatchObject({ ok: true, observation: { text: '画面里有一张表格。', source: '测试图片', model: config.model } })
    const [, options] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0]!
    const body = JSON.parse(String(options.body))
    expect(body.tools).toBeUndefined()
    expect(body.messages[1].content[1].image_url.url).toBe(image)
    expect(options.redirect).toBe('error')
  })
  it('rejects remote image URLs and oversized input before any network request', async () => {
    const fetcher = vi.fn()
    const service = setup(fetcher)
    expect((await service.execute({ ...input, image: 'https://other.example/image' })).ok).toBe(false)
    expect((await service.execute({ ...input, image: `data:image/jpeg;base64,${'A'.repeat(8 * 1024 * 1024)}` })).ok).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('discards a late model result after cancellation', async () => {
    let resolve!: (value: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>(r => resolve = r))
    const service = setup(fetcher)
    const pending = service.execute(input)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    await service.execute({ type: 'cancel', id: input.id })
    resolve(Response.json({ choices: [{ message: { content: 'late' } }] }))
    expect((await pending).ok).toBe(false)
    expect((await service.execute({ type: 'vision-configure', config })).ok).toBe(true)
  })

  it('does not send an image after cancellation during credential loading', async () => {
    let resolve!: (text: string) => void
    const fetcher = vi.fn()
    const service = new VisionService({ read: () => new Promise(r => resolve = r), write: async () => {} }, fetcher)
    const pending = service.execute(input)
    await service.execute({ type: 'cancel', id: input.id })
    resolve(JSON.stringify({ config, key: 'private-vision-key' }))
    expect((await pending).ok).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('does not carry a key to a changed endpoint or accept insecure remote endpoints', async () => {
    expect((await setup().execute({ type: 'vision-configure', config: { ...config, baseURL: 'https://another.example' } })).ok).toBe(false)
    expect(() => validateVision({ ...config, baseURL: 'http://vision.example' })).toThrow()
    expect(validateVision({ ...config, baseURL: 'http://127.0.0.1:8000/v1' }).baseURL).toContain('127.0.0.1')
  })
  it('sanitizes provider failure and rejects tool-only or excessive responses', async () => {
    expect(JSON.stringify(await setup(async () => { throw new Error('private-vision-key') }).execute(input))).not.toContain('private-vision-key')
    expect((await setup(async () => Response.json({ choices: [{ message: { tool_calls: [] } }] })).execute(input)).ok).toBe(false)
    expect((await setup(async () => new Response('a'.repeat(1024 * 1024 + 1))).execute(input)).ok).toBe(false)
  })
})
