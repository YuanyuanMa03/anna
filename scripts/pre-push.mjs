import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const refs = readFileSync(0, 'utf8').trim().split('\n').filter(Boolean).map(line => line.split(/\s+/))
// Git may name the local source HEAD or a SHA; validation follows the remote destination.
const updates = refs.filter(([, sha, ref]) => !/^0+$/.test(sha) && (ref.startsWith('refs/heads/') || ref.startsWith('refs/tags/v')))
if (updates.length) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  for (const [, sha] of updates) {
    if (execFileSync('git', ['rev-parse', `${sha}^{commit}`], { encoding: 'utf8' }).trim() !== head)
      throw new Error('Push the checked-out, reviewed commit only; check out the other branch before validating it.')
  }
  const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
  if (dirty)
    throw new Error('Commit or preserve outstanding changes before validating the pushed commit.')
  // Git exports GIT_DIR, GIT_INDEX_FILE and friends to hooks; from a linked worktree GIT_DIR is absolute.
  // Validation must not see them, or any test that runs `git init`/`git commit` in a temp dir writes into this repository.
  // Drop exactly the repository-local variables git itself clears when entering another repository; keep user settings such as GIT_AUTHOR_NAME.
  const local = new Set(execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).split(/\s+/).filter(Boolean))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !local.has(key.toUpperCase())))
  const result = spawnSync(process.execPath, ['scripts/preflight.mjs'], { stdio: 'inherit', env })
  if (result.status === 0 && (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== head || execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()))
    throw new Error('The reviewed checkout changed during validation; review and validate the new state again.')
  process.exit(result.status === 0 ? 0 : result.status ?? 1)
}
