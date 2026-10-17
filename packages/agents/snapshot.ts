import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const skipped = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.venv', 'venv', '__pycache__', 'target', '.turbo', '.cache', 'coverage', '.data'])
const maxFiles = 5000
const maxBytes = 2 * 1024 * 1024

/**
 * The files an external agent might change, for before/after snapshots. In git repositories this is
 * `git ls-files -co --exclude-standard` (tracked + untracked, honouring .gitignore); elsewhere a bounded walk that
 * skips dependency and build directories. Large files are left out.
 */
export async function workspaceFiles(workspace: string): Promise<string[]> {
  const fromGit = existsSync(join(workspace, '.git'))
    ? await new Promise<string[] | undefined>(resolve => execFile('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: workspace, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => resolve(error ? undefined : stdout.split('\0').filter(Boolean).map(path => join(workspace, path)))))
    : undefined
  const files = fromGit ?? walk(workspace)
  return files.filter((path) => {
    try {
      const stat = statSync(path)
      return stat.isFile() && stat.size <= maxBytes
    }
    catch { return false }
  }).slice(0, maxFiles)
}

function walk(root: string) {
  const out: string[] = []
  const visit = (dir: string) => {
    if (out.length >= maxFiles)
      return
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) }
    catch { return }
    for (const entry of entries) {
      if (out.length >= maxFiles)
        return
      const path = join(dir, entry.name)
      if (entry.isDirectory() && !skipped.has(entry.name) && !entry.isSymbolicLink())
        visit(path)
      else if (entry.isFile())
        out.push(path)
    }
  }
  visit(root)
  return out
}

export function relativeTo(workspace: string, path: string) { return relative(workspace, path) }
