import { chmod, copyFile, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { isRecordList, quarantine, readJson } from '../packages/anna-host/json-file'

describe('readJson', () => {
  it('returns the fallback for a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anna-json-'))
    expect(await readJson(join(dir, 'memory.json'), ['fallback'])).toEqual(['fallback'])
  })

  it('keeps an unreadable file in quarantine and returns the fallback', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anna-json-'))
    await writeFile(join(dir, 'memory.json'), '[{"text"')
    expect(await readJson(join(dir, 'memory.json'), [])).toEqual([])
    const [kept] = await readdir(join(dir, 'quarantine'))
    expect(kept).toMatch(/^memory\.json\.corrupt-/)
    expect(await readFile(join(dir, 'quarantine', kept!), 'utf8')).toBe('[{"text"')
    expect((await readdir(dir))).not.toContain('memory.json')
  })

  it.each([['an object', '{}'], ['null', 'null']])('sets aside valid JSON of the wrong shape: %s', async (_name, text) => {
    const dir = await mkdtemp(join(tmpdir(), 'anna-json-'))
    await writeFile(join(dir, 'memory.json'), text)
    expect(await readJson(join(dir, 'memory.json'), [], Array.isArray)).toEqual([])
    expect(await readdir(join(dir, 'quarantine'))).toHaveLength(1)
  })

  it('copies the file when another program holds it, and never throws when it cannot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anna-json-'))
    const path = join(dir, 'memory.json')
    await writeFile(path, 'broken')
    const held = () => Promise.reject(Object.assign(new Error('busy'), { code: 'EBUSY' }))
    const kept = await quarantine(path, { rename: held, copyFile })
    expect(await readFile(kept!, 'utf8')).toBe('broken')
    await expect(quarantine(path, { rename: held, copyFile: held })).resolves.toBeUndefined()
  })

  it('refuses to start from the fallback when the only copy cannot be set aside', async () => {
    if (process.platform === 'win32')
      return
    const dir = await mkdtemp(join(tmpdir(), 'anna-json-'))
    const path = join(dir, 'memory.json')
    await writeFile(path, 'broken')
    await chmod(dir, 0o500)
    try {
      await expect(readJson(path, [])).rejects.toThrow('set aside')
      expect(await readFile(path, 'utf8')).toBe('broken')
    }
    finally { await chmod(dir, 0o700) }
  })

  it('accepts only lists of records', () => {
    expect(isRecordList([{ text: 'a' }])).toBe(true)
    expect(isRecordList([])).toBe(true)
    expect(isRecordList([null])).toBe(false)
    expect(isRecordList(['a'])).toBe(false)
    expect(isRecordList({})).toBe(false)
  })

  it('reads a file saved with a byte-order mark', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anna-json-'))
    await writeFile(join(dir, 'memory.json'), '\uFEFF[{"text":"a"}]')
    expect(await readJson(join(dir, 'memory.json'), [], isRecordList)).toEqual([{ text: 'a' }])
  })

  it('still reports failures other than bad contents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anna-json-'))
    await expect(readJson(dir, [])).rejects.toThrow()
  })
})
