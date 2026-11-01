import { existsSync, readFileSync } from 'node:fs'
import { win32 } from 'node:path'

/**
 * npm installs an agent on Windows as a .cmd shim, which only cmd.exe can start, and cmd.exe parses every argument again:
 * spaces split a JSON value, a newline ends the prompt, and an `&` in a task would run a command. All the shim does is run
 * `node <script> %*`, or a native `<program>.exe %*`, so Anna runs that herself. Undefined for a .cmd that is neither.
 */
export function unwrapCmdShim(command: string, deps = { read: (path: string) => readFileSync(path, 'utf8'), exists: existsSync as (path: string) => boolean }) {
  const text = deps.read(command)
  // npm writes %dp0%, pnpm %~dp0. The target is what gets the arguments.
  const target = /"%~?dp0%?\\([^"]+)"\s+%\*/i.exec(text)?.[1]
  if (!target)
    return undefined
  const folder = win32.dirname(command)
  if (/\.exe$/i.test(target))
    return { command: win32.join(folder, target), prefix: [] }
  // A shim for something other than a node script (a shell script, say) stays with whatever it asked for.
  if (/_prog=(?!node|%dp0%\\node)/i.test(text))
    return undefined
  const node = win32.join(folder, 'node.exe')
  return { command: deps.exists(node) ? node : 'node', prefix: [win32.join(folder, target)] }
}
