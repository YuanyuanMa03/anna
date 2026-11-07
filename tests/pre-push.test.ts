import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { expect, it } from 'vitest'

const hook = resolve('scripts/pre-push.mjs')
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'anna-push-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init')
  await mkdir(join(dir, 'scripts'))
  await writeFile(join(dir, '.gitignore'), 'validated\ngit-env\n')
  await writeFile(join(dir, 'scripts/preflight.mjs'), 'import {writeFileSync} from "node:fs"; writeFileSync("validated", "yes"); writeFileSync("git-env", JSON.stringify(Object.keys(process.env).filter(key => key.toUpperCase().startsWith("GIT_")))); if(process.env.FIXTURE_EXIT === "mutate") writeFileSync("unreviewed", "change"); else if(process.env.FIXTURE_EXIT === "signal") process.kill(process.pid, "SIGTERM"); else process.exit(Number(process.env.FIXTURE_EXIT || 0));')
  git('add', '.')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture')
  const head = git('rev-parse', 'HEAD')
  const run = (ref: string, sha = head, exit = '0', destination = ref, env: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [hook], { cwd: dir, input: `${ref} ${sha} ${destination} ${'0'.repeat(40)}\n`, encoding: 'utf8', env: { ...process.env, ...env, FIXTURE_EXIT: exit } })
  return { dir, head, git, run }
}
it('runs validation for the exact clean commit and propagates failed checks', async () => {
  const good = await fixture()
  expect(good.run('refs/heads/feature').status).toBe(0)
  expect(existsSync(join(good.dir, 'validated'))).toBe(true)
  const bad = await fixture()
  expect(bad.run('refs/heads/feature', bad.head, '7').status).toBe(7)
  const interrupted = await fixture()
  expect(interrupted.run('refs/heads/feature', interrupted.head, 'signal').status).not.toBe(0)
  const changed = await fixture()
  expect(changed.run('refs/heads/feature', changed.head, 'mutate').status).not.toBe(0)
})
it('refuses dirty worktrees and commits other than the checked-out HEAD', async () => {
  const { dir, head, git, run } = await fixture()
  await writeFile(join(dir, 'unreviewed'), 'change')
  expect(run('refs/heads/feature').status).not.toBe(0)
  expect(existsSync(join(dir, 'validated'))).toBe(false)
  git('add', '.')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'next')
  expect(run('refs/heads/feature', head).status).not.toBe(0)
})
it('allows branch deletion and archival tags without validating an unrelated checkout', async () => {
  const { run, dir } = await fixture()
  expect(run('refs/heads/old', '0'.repeat(40)).status).toBe(0)
  expect(run('refs/tags/archive/old')).toHaveProperty('status', 0)
  expect(existsSync(join(dir, 'validated'))).toBe(false)
})
it('validates HEAD and explicit SHA pushes based on their remote branch destination', async () => {
  const { run, head, dir } = await fixture()
  expect(run('HEAD', head, '7', 'refs/heads/feature').status).toBe(7)
  expect(existsSync(join(dir, 'validated'))).toBe(true)
  expect(run(head, head, '0', 'refs/heads/feature').status).toBe(0)
})
it('runs validation without the hook\'s git environment, as a linked worktree push sets an absolute GIT_DIR', async () => {
  const { run, dir } = await fixture()
  const gitDir = join(dir, '.git')
  // Git exports these to hooks; a linked worktree's GIT_DIR is absolute, so a child `git init` elsewhere would rewrite this repository.
  const hookEnv = { GIT_DIR: gitDir, GIT_INDEX_FILE: join(gitDir, 'index'), GIT_WORK_TREE: dir, GIT_COMMON_DIR: gitDir, GIT_PREFIX: '', GIT_EXEC_PATH: execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim() }
  expect(run('refs/heads/feature', undefined, '0', undefined, hookEnv).status).toBe(0)
  expect(JSON.parse(await readFile(join(dir, 'git-env'), 'utf8'))).toEqual([])
})
