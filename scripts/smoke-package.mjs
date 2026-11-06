import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path, { join, resolve } from 'node:path'
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

/** ripgrep and fd as the packaged agent will find them: in the resources folder next to the executable. */
export function bundledTools(platform, executable, paths = path) {
  const resources = platform === 'darwin' ? paths.join(paths.dirname(executable), '..', 'Resources') : paths.join(paths.dirname(executable), 'resources')
  return ['rg', 'fd'].map(tool => paths.join(resources, 'bin', platform === 'win32' ? `${tool}.exe` : tool))
}

export function startupState(log) {
  if (/\bstartup failed\b|\bcore exited\b|\bcore gave up\b|\bwindow failed to load\b|\bwindow process gone\b/.test(log))
    return 'failed'
  return /\bcore ready\b/.test(log) && /\bwindow loaded\b/.test(log) ? 'ready' : 'waiting'
}

async function main() {
  const given = resolve(process.argv[2] ?? packagedExecutable(process.platform, process.cwd()))
  if (!existsSync(given))
    throw new Error(`No packaged app at ${given}. Package it first, or pass the path of the executable.`)
  // The deb's /usr/bin/anna is a link: the resources sit beside what it points to.
  const executable = realpathSync(given)
  // A tool that the system refuses to run (quarantine, antivirus, wrong architecture) leaves the agent unable to search.
  for (const tool of bundledTools(process.platform, executable)) {
    try { execFileSync(tool, ['--version'], { stdio: 'ignore', timeout: 30_000 }) }
    catch (error) { throw new Error(`The bundled ${tool} does not run: ${error.message}`) }
  }
  const data = await mkdtemp(join(tmpdir(), 'anna smoke 启动-'))
  const logPath = join(data, 'logs', 'anna.log')
  const read = () => existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  // Not tests/desktop-launch.mjs: this also checks an installed app, on machines without the repository's dependencies.
  // Started the way a person starts it: nothing from the checkout or from pnpm to lean on.
  const { ELECTRON_RUN_AS_NODE: _node, NODE_PATH: _modules, ...env } = process.env
  const child = spawn(executable, [], { cwd: data, env: { ...env, ANNA_DATA_DIR: data, ANNA_QUIET_FAILURES: '1' }, stdio: 'ignore' })
  const run = { exited: undefined }
  child.on('exit', (code, signal) => { run.exited = { code, signal } })
  child.on('error', (error) => { run.exited = { error: error.message } })
  const deadline = Date.now() + Number(process.env.ANNA_SMOKE_TIMEOUT ?? 90000)
  while (startupState(read()) === 'waiting' && !run.exited && Date.now() < deadline)
    await sleep(250)
  // Staying up matters as much as coming up: a core that dies right after saying it is ready is not a working app.
  if (startupState(read()) === 'ready')
    await sleep(3000)
  const state = run.exited ? 'exited early' : startupState(read())
  await stop(child, run)
  // After the process has gone: its last lines are often the reason.
  const log = read()
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
  if (process.platform === 'win32') {
    // Killing only the root would leave the core and hold the temporary folder. It may already be gone: that is fine.
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) }
    catch {}
  }
  else {
    child.kill()
  }
  for (let waited = 0; waited < 5000 && !run.exited; waited += 250)
    await sleep(250)
  if (!run.exited)
    child.kill('SIGKILL')
  await sleep(500)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
