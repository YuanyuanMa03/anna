import { expect, it, vi } from 'vitest'
import { resolveWorkspace } from '../packages/anna-host/workspace'

it.each(['C:\\Users\\a\\文档 项目', '\\\\server\\share\\项目 空格', '/Volumes/Disk/项目 空格'])('passes native path %s unchanged to the filesystem', async (path) => {
  const realpath = vi.fn(async (input: string) => input)
  const result = await resolveWorkspace(path, { realpath, stat: async () => ({ isDirectory: () => true }) })
  expect(result).toBe(path)
  expect(realpath).toHaveBeenCalledWith(path)
})

it.each(['ENOENT', 'EACCES', 'ENOTCONN'])('explains inaccessible directories (%s)', async (code) => {
  await expect(resolveWorkspace('unavailable', { realpath: async () => { throw Object.assign(new Error('native error'), { code }) }, stat: async () => ({ isDirectory: () => true }) })).rejects.toThrow(/目录/)
})

it('rejects a file instead of a directory', async () => {
  await expect(resolveWorkspace('file.txt', { realpath: async value => value, stat: async () => ({ isDirectory: () => false }) })).rejects.toThrow('而不是文件')
})
