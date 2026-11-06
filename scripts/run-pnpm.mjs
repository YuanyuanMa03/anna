import { execFileSync } from 'node:child_process'
import process from 'node:process'

/** pnpm's .cmd shim must never parse paths or JSON arguments through a shell. */
export function runPnpm(args) {
  const entry = process.env.npm_execpath
  if (entry && /\.[cm]?js$/i.test(entry))
    return execFileSync(process.execPath, [entry, ...args], { stdio: 'inherit' })
  if (entry && !/\.(?:cmd|bat)$/i.test(entry))
    return execFileSync(entry, args, { stdio: 'inherit' })
  if (process.platform === 'win32')
    throw new Error('Run this build through its pnpm package script so the pnpm JavaScript entry is known')
  return execFileSync('pnpm', args, { stdio: 'inherit' })
}
