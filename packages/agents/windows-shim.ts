import { existsSync, readFileSync } from 'node:fs'
import { win32 } from 'node:path'
import process from 'node:process'

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

/** Arguments cmd.exe would pass through unchanged: no spaces, quotes, `%`, `^`, `&`, `|`, `<`, `>` or line breaks. */
const plain = /^[\w.:=@/+\\-]+$/

/**
 * How to start a Windows script with an argument list and no `shell: true` (which concatenates the arguments, and which
 * Node now warns about). Programs start as they are; npm shims and Node's own npm.cmd become node plus their script;
 * a .ps1 goes to PowerShell with `-File`; any other .cmd goes to cmd.exe verbatim, only when nothing in it needs quoting.
 * Undefined when it cannot be started safely.
 */
export function scriptLaunch(command: string, args: string[], deps: { read: (path: string) => string, exists: (path: string) => boolean, comspec?: string, systemRoot?: string } = { read: path => readFileSync(path, 'utf8'), exists: existsSync, comspec: process.env.ComSpec, systemRoot: process.env.SystemRoot }): { command: string, args: string[], verbatim?: true } | undefined {
  // Bypass applies to this one script only: the default policy refuses unsigned scripts such as an npm .ps1 shim.
  if (/\.ps1$/i.test(command))
    // The full path: the agent's own folder is first on its PATH and must not supply a powershell.exe.
    return { command: win32.join(deps.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', command, ...args] }
  if (!/\.(?:cmd|bat)$/i.test(command))
    return { command, args }
  const folder = win32.dirname(command)
  const npmCli = win32.join(folder, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (/^npm\.cmd$/i.test(win32.basename(command)) && deps.exists(npmCli)) {
    const node = win32.join(folder, 'node.exe')
    return { command: deps.exists(node) ? node : 'node', args: [npmCli, ...args] }
  }
  const shim = unwrapCmdShim(command, deps)
  if (shim)
    return { command: shim.command, args: [...shim.prefix, ...args] }
  if (!/^[^"%^&|<>\r\n]+$/.test(command) || !args.every(arg => plain.test(arg)))
    return undefined
  // `/s /c "<line>"`: cmd.exe strips the outer quotes and runs the line as written, so Node must not re-quote it.
  // `/v:off` keeps `!` literal even where delayed expansion is turned on in the registry.
  return { command: deps.comspec || 'cmd.exe', args: ['/d', '/v:off', '/s', '/c', `"${[`"${command}"`, ...args].join(' ')}"`], verbatim: true }
}
