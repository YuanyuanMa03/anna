import type { TaskUsage } from '../shared/contracts'
import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import process from 'node:process'
import { isDeepStrictEqual, promisify } from 'node:util'

export interface BenchmarkCase {
  id: string
  category: string
  prompt: string
  files: Record<string, string>
  requiredFiles: string[]
  checks: Record<string, unknown>
  testCommand: string | null
  rubric: string[]
}

function taskPath(workspace: string, path: string) {
  const target = resolve(workspace, path)
  if (!target.startsWith(`${resolve(workspace)}${sep}`))
    throw new Error('基准文件路径必须位于隔离目录内')
  return target
}
export async function prepareCase(item: BenchmarkCase, workspace: string) {
  // A new directory is mandatory: do not overwrite old evidence on retries.
  await mkdir(workspace, { recursive: false })
  for (const [path, content] of Object.entries(item.files)) {
    const target = taskPath(workspace, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, { flag: 'wx' })
  }
}

export async function collectFiles(workspace: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  async function visit(directory: string, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory())
        await visit(join(directory, entry.name), path)
      else if (entry.isFile())
        files[path] = await readFile(join(directory, entry.name), 'utf8')
      // Symlinks are never followed into the user's files.
    }
  }
  await visit(workspace)
  return files
}

export async function checkCase(item: BenchmarkCase, workspace: string) {
  const files = await collectFiles(workspace)
  const failures: string[] = []
  for (const path of item.requiredFiles) {
    if (!files[path]?.trim())
      failures.push(`缺少成果：${path}`)
  }
  for (const [path, content] of Object.entries(item.files)) {
    const editable = item.category === 'code' && item.requiredFiles.includes(path)
    if (!editable && files[path] !== content)
      failures.push(`源文件被修改或丢失：${path}`)
  }
  for (const [path, expected] of Object.entries(item.checks)) {
    if (path === 'json') {
      for (const [file, value] of Object.entries(expected as Record<string, unknown>)) {
        try {
          const actual = JSON.parse(files[file] ?? '')
          // Duplicate groups and their members may be listed in any order.
          const normalized = (input: unknown): unknown => Array.isArray(input) ? input.map(normalized).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : input
          if (!isDeepStrictEqual(normalized(actual), normalized(value)))
            failures.push(`JSON 内容不符合要求：${file}`)
        }
        catch { failures.push(`无效 JSON：${file}`) }
      }
    }
    else if (path === 'preservedCopies') {
      const copies = Object.entries(files).filter(([file]) => file.startsWith('organized/')).map(([, text]) => text)
      for (const content of expected as string[]) {
        if (!copies.includes(content))
          failures.push('没有保留两份不同内容的副本')
      }
    }
    else {
      for (const text of expected as string[]) {
        if (!files[path]?.includes(text))
          failures.push(`${path} 缺少事实：${text}`)
      }
    }
  }
  if (item.id === 'T01') {
    const length = [...(files['result.md'] ?? '').replace(/\s/g, '')].length
    if (length < 100 || length > 180)
      failures.push('通知未满足 100–180 字')
  }
  let verification: string | undefined
  if (item.testCommand) {
    if (item.testCommand !== 'node --test')
      throw new Error('基准只允许预设的 Node 测试命令')
    if (!failures.length) {
      try {
        const result = await promisify(execFile)(process.execPath, ['--test'], { cwd: workspace, timeout: 30_000, maxBuffer: 512_000 })
        verification = result.stdout
      }
      catch { failures.push('现有 Node 测试失败或超时') }
    }
  }
  return { success: !failures.length, failures, verification, deliverables: Object.fromEntries(Object.entries(files).filter(([path]) => files[path] !== item.files[path])) }
}

/** Measurement subscription for an unchanged baseline runtime; never estimates tokens. */
export class PiMeasurements {
  private reports = new Map<object, TaskUsage | undefined>()
  retries = 0
  delegated = false
  message(message: { role?: string, usage?: { totalTokens?: number, input?: number, output?: number, cacheRead?: number, cacheWrite?: number } }) {
    if (message.role !== 'assistant')
      return
    const usage = message.usage
    this.reports.set(message, usage && (usage.totalTokens ?? 0) > 0 ? { partial: false, input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite } : undefined)
  }

  get usage(): TaskUsage | undefined {
    if (!this.reports.size)
      return undefined
    const result: TaskUsage = { partial: this.delegated }
    for (const report of this.reports.values()) {
      for (const field of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
        const value = report?.[field]
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
          result[field] = (result[field] ?? 0) + value
        else
          result.partial = true
      }
    }
    return result
  }
}
