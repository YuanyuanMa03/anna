import type { DetectEnvironment } from './detect'
import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname } from 'node:path'
import process from 'node:process'
import { unwrapCmdShim } from './windows-shim'

/** The real machine, for detectAgents. Commands time out so one hung CLI cannot stall detection. */
export function nodeEnvironment(): DetectEnvironment {
  return {
    platform: process.platform,
    home: homedir(),
    env: process.env,
    exists: path => existsSync(path),
    list: (dir) => {
      try { return readdirSync(dir) }
      catch { return [] }
    },
    run: (command, args) => new Promise((resolve) => {
      // npm shims on Windows are .cmd files; a script Anna cannot run directly needs a shell.
      const script = process.platform === 'win32' && /\.(?:cmd|bat|ps1)$/i.test(command)
      const shim = script && !/\.ps1$/i.test(command) ? unwrapCmdShim(command) : undefined
      // npm-installed CLIs are `#!/usr/bin/env node` scripts: put their own bin dir (where node lives for nvm/fnm) first.
      const env = { ...process.env, PATH: [dirname(command), process.env.PATH].filter(Boolean).join(delimiter), NO_COLOR: '1', CI: '1' }
      execFile(shim?.command ?? command, [...(shim?.prefix ?? []), ...args], { timeout: 8000, shell: script && !shim, windowsHide: true, env }, (error, stdout, stderr) => {
        // Some CLIs (codex login status) report on stderr.
        resolve({ stdout: `${stdout ?? ''}${stderr ?? ''}`, code: error ? (typeof error.code === 'number' ? error.code : 1) : 0 })
      })
    }),
  }
}
