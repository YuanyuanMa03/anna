import { spawnSync } from 'node:child_process'
import process from 'node:process'

for (const [command, args] of [['git', ['diff', '--check']], ['pnpm', ['lint']], ['pnpm', ['typecheck']], ['pnpm', ['test']]]) {
  const result = spawnSync(process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command, args, { stdio: 'inherit', shell: process.platform === 'win32' && command === 'pnpm' })
  if (result.error || result.status !== 0) {
    process.stderr.write(`Preflight failed: ${command} ${args.join(' ')}\n`)
    process.exit(result.status || 1)
  }
}
