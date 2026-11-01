import { existsSync, readFileSync } from 'node:fs'
import { win32 } from 'node:path'

/**
 * npm installs an agent on Windows as a .cmd shim, which only cmd.exe can start, and cmd.exe parses every argument again:
 * spaces split a JSON value, a newline ends the prompt, and an `&` in a task would run a command. All the shim does is run
 * `node <script> %*`, so Anna runs that herself. Undefined for a .cmd that is not such a shim.
 */
export function unwrapCmdShim(command: string, deps = { read: (path: string) => readFileSync(path, 'utf8'), exists: existsSync as (path: string) => boolean }) {
  const script = /"%dp0%\\([^"]+)"\s+%\*/.exec(deps.read(command))?.[1]
  if (!script)
    return undefined
  const folder = win32.dirname(command)
  const node = win32.join(folder, 'node.exe')
  return { command: deps.exists(node) ? node : 'node', prefix: [win32.join(folder, script)] }
}
