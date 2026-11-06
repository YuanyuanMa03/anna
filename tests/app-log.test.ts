import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { createAppLog } from '../packages/shared/app-log'

const folder = () => mkdtemp(join(tmpdir(), 'anna log 日志-'))

describe('app log', () => {
  it('creates its folder and appends timestamped lines by source', async () => {
    const dir = join(await folder(), 'logs')
    const log = createAppLog(dir, { now: () => new Date('2026-11-05T12:00:00Z') })
    log.write('core', 'first\n')
    log.write('main', 'second')
    expect(log.path).toBe(join(dir, 'anna.log'))
    expect(await readFile(log.path, 'utf8')).toBe('2026-11-05T12:00:00.000Z [core] first\n2026-11-05T12:00:00.000Z [main] second\n')
  })

  it('keeps one previous file and stays within its size limit', async () => {
    const dir = await folder()
    const log = createAppLog(dir, { maxBytes: 200 })
    for (let index = 0; index < 20; index++)
      log.write('core', `line ${index} ${'x'.repeat(30)}`)
    expect((await stat(log.path)).size).toBeLessThanOrEqual(200)
    expect(await readFile(`${log.path}.1`, 'utf8')).toContain('line')
  })

  it('never writes credentials it can recognize', async () => {
    const dir = await folder()
    const log = createAppLog(dir)
    log.write('core', 'failed sk-abcdefghijklmnop1234 Authorization: Bearer secret-token-value api_key=hunter2hunter2')
    const text = await readFile(log.path, 'utf8')
    for (const secret of ['sk-abcdefghijklmnop1234', 'secret-token-value', 'hunter2hunter2'])
      expect(text).not.toContain(secret)
    expect(text).toContain('failed')
  })

  it.each([
    'ANTHROPIC_API_KEY=abc123xyz',
    'access_token=tok999999',
    'accessToken: tok999999',
    '"bot_token":"bot777777"',
    '\\"token\\":\\"esc777777\\"',
    'client_secret: cs5555555',
    'Authorization: Basic dXNlcjpw',
    'https://example.test/v1?key=url555555',
    'hf_abcdefgh12345abcdefgh12345',
    'ms-abcdef12-3456-abcd-ef12-3456abcdef12',
  ])('masks %s', async (line) => {
    const log = createAppLog(await folder())
    log.write('core', `before ${line} after`)
    const text = await readFile(log.path, 'utf8')
    for (const secret of ['abc123xyz', 'tok999999', 'bot777777', 'esc777777', 'cs5555555', 'dXNlcjpw', 'url555555', 'abcdefgh12345', 'abcdef12-3456'])
      expect(text).not.toContain(secret)
    expect(text).toContain('before')
  })

  it('masks a whole quoted value, and leaves ordinary paths and names readable', async () => {
    const log = createAppLog(await folder())
    log.write('core', '"password":"my pass word" /opt/ms-playwright/x hf_hub_download')
    const text = await readFile(log.path, 'utf8')
    expect(text).not.toContain('pass word')
    expect(text).toContain('/opt/ms-playwright/x hf_hub_download')
  })

  it('handles a huge unbroken line quickly', async () => {
    const log = createAppLog(await folder())
    const started = Date.now()
    log.write('window', 'a'.repeat(4 * 1024 * 1024))
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('keeps a credential and a character whole when output arrives in pieces', async () => {
    const log = createAppLog(await folder())
    const lines = log.stream('core')
    const bytes = Buffer.from('启动 sk-abcdefghijklmnop1234 失败\nrest')
    for (const byte of bytes)
      lines.push(Buffer.from([byte]))
    lines.flush()
    const text = await readFile(log.path, 'utf8')
    expect(text).not.toContain('abcdefghijklmnop1234')
    expect(text).toContain('启动')
    expect(text).toContain('失败')
    expect(text).not.toContain('\uFFFD')
    expect(text).toMatch(/\[core\] rest\n$/)
  })

  it('stays within the limit in bytes for text that is not ASCII', async () => {
    const log = createAppLog(await folder(), { maxBytes: 100 })
    log.write('core', '启'.repeat(500))
    expect((await stat(log.path)).size).toBeLessThanOrEqual(100)
  })

  it('is private to the user on systems with file modes', async () => {
    const dir = await folder()
    const log = createAppLog(dir)
    log.write('main', 'hello')
    if (process.platform !== 'win32')
      expect((await stat(log.path)).mode & 0o077).toBe(0)
  })

  it('never throws when the folder cannot be written', async () => {
    const dir = await folder()
    await writeFile(join(dir, 'taken'), 'a file, not a folder')
    const log = createAppLog(join(dir, 'taken', 'logs'))
    expect(() => log.write('main', 'hello')).not.toThrow()
  })
})
