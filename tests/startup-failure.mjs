import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { _electron } from 'playwright'
import { desktopLaunch } from './desktop-launch.mjs'

/** What a stranger sees when Anna cannot start: an explanation and a log, never a window that stays at "waking up". */
async function main() {
  await mkdir('.data', { recursive: true })
  if (!process.env.ANNA_PACKAGED_APP)
    await missingModule()
  await coreThatKeepsDying()
  process.stdout.write('Startup failures: a missing module and a dying core both name the log, and the log says why.\n')
}

async function missingModule() {
  const data = await mkdtemp(resolve('.data/startup-module-'))
  const entry = join(data, 'broken-main.mjs')
  await writeFile(entry, 'import \'anna-missing-module-fixture\'\n')
  const launch = desktopLaunch(data, { ANNA_TEST_MAIN: pathToFileURL(entry).href, ANNA_QUIET_FAILURES: '1' })
  const child = spawn(launch.executablePath, launch.args, { cwd: launch.cwd, env: launch.env, stdio: 'ignore' })
  const code = await new Promise((done, fail) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error('Anna kept running with a main process that cannot load'))
    }, 30000)
    child.on('exit', (exit) => {
      clearTimeout(timer)
      done(exit)
    })
  })
  assert.equal(code, 1)
  assert.match(await readFile(join(data, 'logs', 'anna.log'), 'utf8'), /anna-missing-module-fixture/)
}

async function coreThatKeepsDying() {
  const data = await mkdtemp(resolve('.data/startup-core-'))
  // A folder where a state file belongs is an error Anna must not paper over, so the core exits every time.
  await mkdir(join(data, 'memory.json'))
  const desktop = await _electron.launch(desktopLaunch(data, { ANNA_QUIET_FAILURES: '1' }))
  try {
    const page = await desktop.firstWindow()
    await page.locator('.boot').getByText('日志在').waitFor({ timeout: 30000 })
    const shown = await page.locator('.boot').textContent()
    assert(shown.includes(join(data, 'logs', 'anna.log')), shown)
    const log = await readFile(join(data, 'logs', 'anna.log'), 'utf8')
    assert.match(log, /core gave up/)
    assert.match(log, /EISDIR/)
  }
  finally { await desktop.close() }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
