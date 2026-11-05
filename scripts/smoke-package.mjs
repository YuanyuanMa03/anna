import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

/**
 * Does the packaged app actually start? Runs it with an empty data folder and reads its log, so it needs no test
 * framework, no hosted CI and no credentials: on any target machine, `pnpm smoke:package [path to the executable]`.
 */
export function packagedExecutable(platform, root, joinPath = join) {
  if (platform === 'win32')
    return joinPath(root, 'dist', 'windows', 'Anna', 'Anna.exe')
  if (platform === 'darwin')
    return joinPath(root, 'dist', 'macos', 'Anna.app', 'Contents', 'MacOS', 'Anna')
  return joinPath(root, 'dist', 'linux', 'Anna', 'anna')
}

export function startupState(log) {
  if (/\bcore exited\b|\bcore gave up\b|\bwindow failed to load\b|\bwindow process gone\b/.test(log))
    return 'failed'
  return /\bcore ready\b/.test(log) && /\bwindow loaded\b/.test(log) ? 'ready' : 'waiting'
}

async function main() {
  const executable = resolve(process.argv[2] ?? packagedExecutable(process.platform, process.cwd()))
  if (!existsSync(executable))
    throw new Error(`No packaged app at ${executable}. Package it first, or pass the path of the executable.`)
  const data = await mkdtemp(join(tmpdir(), 'anna smoke 启动-'))
  const logPath = join(data, 'logs', 'anna.log')
  const read = () => existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  const { ELECTRON_RUN_AS_NODE: _node, ...env } = process.env
  const child = spawn(executable, [], { env: { ...env, ANNA_DATA_DIR: data }, stdio: 'ignore' })
  const run = { exited: undefined }
  child.on('exit', (code, signal) => { run.exited = { code, signal } })
  child.on('error', (error) => { run.exited = { error: error.message } })
  const deadline = Date.now() + Number(process.env.ANNA_SMOKE_TIMEOUT ?? 90000)
  while (startupState(read()) === 'waiting' && !run.exited && Date.now() < deadline)
    await sleep(250)
  // Staying up matters as much as coming up: a core that dies right after saying it is ready is not a working app.
  if (startupState(read()) === 'ready')
    await sleep(3000)
  const log = read()
  const state = run.exited ? 'exited early' : startupState(log)
  await stop(child, run)
  await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(() => {})
  if (state !== 'ready') {
    process.stderr.write(`Anna did not start (${state === 'waiting' ? 'timed out' : state}${run.exited ? `: ${JSON.stringify(run.exited)}` : ''}).\n--- log ---\n${log || '(no log was written)'}\n`)
    process.exit(1)
  }
  process.stdout.write(`Anna started: ${executable}\n`)
  process.exit(0)
}

/** Ask, then insist: a modal error box ignores a polite request, and the script must never hang or leave Anna behind. */
async function stop(child, run) {
  if (run.exited)
    return
  child.kill()
  for (let waited = 0; waited < 5000 && !run.exited; waited += 250)
    await sleep(250)
  if (run.exited)
    return
  if (process.platform === 'win32')
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else
    child.kill('SIGKILL')
  await sleep(500)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
