import type { Buffer } from 'node:buffer'
import type { FileChange } from '../shared/contracts'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { canonical } from '../permissions/paths'

interface Entry { path: string, existed: boolean, blob?: string }
interface Manifest { taskId: string, workspace: string, entries: Entry[], after?: Record<string, string | null> }
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')
const maxBytes = 5 * 1024 * 1024

/**
 * File checkpoints for undo: before a tool first writes a file in a task, its previous content is stored.
 * Covers Anna's file tools (write/edit). Changes made by shell commands are not captured, as in Claude Code.
 */
export class Checkpoints {
  private manifests = new Map<string, Manifest>()
  constructor(private directory: string) {}

  private file(taskId: string) { return join(this.directory, taskId, 'manifest.json') }
  private async load(taskId: string) {
    const cached = this.manifests.get(taskId)
    if (cached)
      return cached
    try {
      const manifest = JSON.parse(await readFile(this.file(taskId), 'utf8')) as Manifest
      this.manifests.set(taskId, manifest)
      return manifest
    }
    catch { return undefined }
  }

  private async save(manifest: Manifest) {
    await mkdir(join(this.directory, manifest.taskId), { recursive: true, mode: 0o700 })
    await writeFile(this.file(manifest.taskId), JSON.stringify(manifest), { mode: 0o600 })
  }

  /** Remember a file's content before the first change in this task. */
  async capture(taskId: string, workspaceInput: string, pathInput: string) {
    // Symlinked locations (macOS /var → /private/var) must map to one entry.
    const workspace = canonical(workspaceInput)
    const path = canonical(pathInput)
    const manifest = (await this.load(taskId)) ?? { taskId, workspace, entries: [] }
    this.manifests.set(taskId, manifest)
    if (manifest.entries.some(entry => entry.path === path))
      return
    if (!existsSync(path)) {
      manifest.entries.push({ path, existed: false })
    }
    else {
      const data = await readFile(path)
      if (data.length > maxBytes)
        return
      const blob = hash(data)
      await mkdir(join(this.directory, taskId, 'blobs'), { recursive: true, mode: 0o700 })
      await writeFile(join(this.directory, taskId, 'blobs', blob), data, { mode: 0o600 })
      manifest.entries.push({ path, existed: true, blob })
    }
    await this.save(manifest)
  }

  /** Record a file that appeared during the task (it did not exist when the task's snapshot was taken). */
  async markCreated(taskId: string, workspaceInput: string, pathInput: string) {
    const workspace = canonical(workspaceInput)
    const path = canonical(pathInput)
    const manifest = (await this.load(taskId)) ?? { taskId, workspace, entries: [] }
    this.manifests.set(taskId, manifest)
    if (!manifest.entries.some(entry => entry.path === path)) {
      manifest.entries.push({ path, existed: false })
      await this.save(manifest)
    }
  }

  /** Paths already snapshotted for a task. */
  async known(taskId: string) { return new Set((await this.load(taskId))?.entries.map(entry => entry.path) ?? []) }
  /** Whether a path (in any spelling) is already recorded. */
  async has(taskId: string, path: string) { return (await this.known(taskId)).has(canonical(path)) }

  /** Seal the task: remember what each file looked like afterwards, so undo can detect later edits. */
  async seal(taskId: string) {
    const manifest = await this.load(taskId)
    if (!manifest)
      return []
    manifest.after = {}
    for (const entry of manifest.entries) manifest.after[entry.path] = existsSync(entry.path) ? hash(await readFile(entry.path)) : null
    await this.save(manifest)
    return this.changes(taskId)
  }

  async changes(taskId: string): Promise<FileChange[]> {
    const manifest = await this.load(taskId)
    if (!manifest)
      return []
    const out: FileChange[] = []
    for (const entry of manifest.entries) {
      const exists = existsSync(entry.path)
      if (!entry.existed && !exists)
        continue
      const before = entry.blob ? await readFile(join(this.directory, taskId, 'blobs', entry.blob), 'utf8') : ''
      const after = exists ? await readFile(entry.path, 'utf8') : ''
      if (entry.existed && before === after)
        continue
      const name = relative(manifest.workspace, entry.path) || entry.path
      const patch = createTwoFilesPatch(`a/${name}`, `b/${name}`, before, after, '', '', { context: 3 })
      const added = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).length
      const removed = patch.split('\n').filter(line => line.startsWith('-') && !line.startsWith('---')).length
      out.push({ path: name, status: !entry.existed ? 'added' : exists ? 'modified' : 'deleted', added, removed, patch: patch.length > 60000 ? `${patch.slice(0, 60000)}\n…` : patch })
    }
    return out
  }

  /** Restore every file the task changed. Files edited again after the task are reported, and left alone unless forced. */
  async undo(taskId: string, force = false) {
    const manifest = await this.load(taskId)
    if (!manifest)
      throw new Error('找不到这次任务的检查点')
    const conflicts: string[] = []
    for (const entry of manifest.entries) {
      const now = existsSync(entry.path) ? hash(await readFile(entry.path)) : null
      if (manifest.after && manifest.after[entry.path] !== undefined && manifest.after[entry.path] !== now)
        conflicts.push(relative(manifest.workspace, entry.path))
    }
    if (conflicts.length && !force)
      return { restored: [], conflicts }
    const restored: string[] = []
    for (const entry of manifest.entries) {
      if (entry.existed)
        await writeFile(entry.path, await readFile(join(this.directory, taskId, 'blobs', entry.blob!)))
      else
        await rm(entry.path, { force: true })
      restored.push(relative(manifest.workspace, entry.path))
    }
    await rm(join(this.directory, taskId), { recursive: true, force: true })
    this.manifests.delete(taskId)
    return { restored, conflicts }
  }
}
