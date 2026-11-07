// Deploy the online line to the ModelScope Studio from git, in one command:
//   pnpm deploy:studio
// Deploys exactly the pushed tip of the online branch — it refuses to ship uncommitted or unpushed
// work, so the Studio can only ever be what the branch says. Steps: guard → build → package →
// commit the snapshot in artifacts/modelscope → push to the Studio's git → POST deploy → watch the
// build and run logs until the server says it is listening.
//
// The Studio is a docker-type repo whose history is deploy snapshots (built renderer + bundled
// server, never source): building on the free 2vCPU tier would pull the whole dev toolchain and
// multiply every deploy's failure surface, so the build stays local and deterministic; this script
// is the bridge that keeps those snapshots pinned to the branch.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

const branch = process.argv.includes('--branch') ? process.argv[process.argv.indexOf('--branch') + 1] : 'release/online-v1.0.1'
const studio = process.env.ANNA_STUDIO ?? 'mayy101184/anna'
const endpoint = process.env.MODELSCOPE_ENDPOINT ?? 'https://modelscope.cn'
const studioDir = resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'artifacts/modelscope')
const lock = `${studioDir}/package-lock.json`
const savedLock = `${studioDir}/package-lock.studio.json`

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options })
}
function fail(message) {
  console.error(`deploy-studio: ${message}`)
  process.exit(1)
}
let token
async function api(path, init) {
  token ??= process.env.MODELSCOPE_API_KEY ?? /oauth2:([^@]+)@/.exec(run('git', ['-C', studioDir, 'remote', 'get-url', 'modelscope']))?.[1]
  if (!token)
    fail('no ModelScope token: set MODELSCOPE_API_KEY or keep it in the studio remote URL')
  const answer = await fetch(`${endpoint}/openapi/v1${path}`, { ...init, headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json', ...init?.headers } })
  const body = await answer.json().catch(() => ({}))
  if (!body.success)
    fail(`${init?.method ?? 'GET'} ${path} failed: ${JSON.stringify(body).slice(0, 400)}`)
  return body.data
}

// ── Guards: the Studio may only receive what the online branch already says ────────────────────────────
if (run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim() !== branch)
  fail(`checkout ${branch} first (now on ${run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim()})`)
run('git', ['fetch', 'origin', branch])
if (run('git', ['status', '--porcelain']).trim())
  fail('worktree is dirty; commit or stash first')
const head = run('git', ['rev-parse', 'HEAD']).trim()
if (head !== run('git', ['rev-parse', `origin/${branch}`]).trim())
  fail(`HEAD ${head.slice(0, 8)} is not origin/${branch}; push first`)
console.log(`deploy-studio: ${branch} @ ${head.slice(0, 8)} — ${run('git', ['log', '-1', '--format=%s']).trim()}`)

// ── Build + package the snapshot ───────────────────────────────────────────────────────────────────────
if (existsSync(lock))
  await cp(lock, savedLock)
run('pnpm', ['build:web'], { stdio: 'inherit' })
run('node', ['scripts/package-modelscope.mjs', studioDir], { stdio: 'inherit' })
// The package step re-resolves the lockfile against today's registry; keep the Studio's reviewed one
// (the behaviour of every deploy so far) unless runtime dependencies actually changed.
if (existsSync(savedLock)) {
  const kept = JSON.parse(await readFile(savedLock, 'utf8'))
  const fresh = JSON.parse(await readFile(lock, 'utf8'))
  if (JSON.stringify(fresh.packages?.['']?.dependencies) === JSON.stringify(kept.packages?.['']?.dependencies))
    await cp(savedLock, lock)
  else
    fail(`runtime dependencies changed; review the fresh ${lock} against ${savedLock} and commit it by hand`)
  await rm(savedLock)
}

// ── Commit the snapshot in the Studio repo, on top of whatever is already live ─────────────────────────
run('git', ['fetch', 'modelscope', 'master'], { cwd: studioDir })
const remoteTip = run('git', ['rev-parse', 'modelscope/master'], { cwd: studioDir }).trim()
run('git', ['add', '-A'], { cwd: studioDir })
const changed = run('git', ['status', '--porcelain'], { cwd: studioDir }).trim()
if (!changed && !process.argv.includes('--force'))
  fail('nothing to deploy (snapshot matches the Studio); pass --force to redeploy anyway')
if (changed)
  run('git', ['commit', '-m', `Deploy from ${head.slice(0, 8)} (${run('git', ['log', '-1', '--format=%s']).trim()})`], { cwd: studioDir, stdio: 'inherit' })
if (run('git', ['rev-parse', 'HEAD'], { cwd: studioDir }).trim() !== remoteTip) {
  // Snapshot histories: when both sides built the same file, this deploy's build wins.
  try {
    run('git', ['rebase', '-X', 'theirs', 'modelscope/master'], { cwd: studioDir, stdio: 'inherit' })
  }
  catch {
    run('git', ['-C', studioDir, 'rebase', '--abort'])
    fail(`could not rebase onto the live studio history ${remoteTip.slice(0, 7)}; resolve ${studioDir} by hand`)
  }
}
const studioCommit = run('git', ['rev-parse', 'HEAD'], { cwd: studioDir }).trim()
run('git', ['push', 'modelscope', 'HEAD:master'], { cwd: studioDir, stdio: 'inherit' })
console.log(`deploy-studio: studio commit ${studioCommit.slice(0, 7)} pushed`)

// ── Deploy and watch the logs: docker builds first, then a fresh "listening" line appears ──────────────
// A redeploy can append to the old run log or replace it outright, so the baseline is the old
// content itself: success is a "listening" line that the old content did not already contain.
const baseline = (await api(`/studios/${studio}/logs/run`))?.logs ?? ''
await api(`/studios/${studio}/deploy`, { method: 'POST' })
console.log('deploy-studio: deploy requested; watching logs…')
const started = Date.now()
for (;;) {
  await new Promise(done => setTimeout(done, 20_000))
  const build = ((await api(`/studios/${studio}/logs/build`))?.logs ?? '').slice(-2000)
  if (/\bERROR\b|error:|failed to|COPY failed|returned a non-zero code/i.test(build))
    fail(`image build failed:\n${build}`)
  const runLog = (await api(`/studios/${studio}/logs/run`))?.logs ?? ''
  const fresh = runLog.length >= baseline.length ? runLog.slice(baseline.length) : runLog
  if (runLog !== baseline && /listening on port/.test(fresh)) {
    console.log(`deploy-studio: running after ${Math.round((Date.now() - started) / 1000)}s — ${endpoint}/studios/${studio}`)
    console.log(`rollback: git -C ${studioDir} push -f modelscope ${remoteTip}:master, then POST deploy again`)
    break
  }
  if (Date.now() - started > 12 * 60_000)
    fail(`timed out after 12 min; build tail:\n${build}\nrun tail:\n${runLog.slice(-800)}`)
  process.stdout.write(`  ${Math.round((Date.now() - started) / 1000)}s…\n`)
}
