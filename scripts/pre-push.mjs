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
  const result = spawnSync(process.execPath, ['scripts/preflight.mjs'], { stdio: 'inherit' })
  if (result.status === 0 && (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== head || execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()))
    throw new Error('The reviewed checkout changed during validation; review and validate the new state again.')
  process.exit(result.status === 0 ? 0 : result.status ?? 1)
}
