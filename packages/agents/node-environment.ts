import type { DetectEnvironment } from './detect'
import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import process from 'node:process'
import { withSearchTools } from '../shared/search-path'
import { scriptLaunch } from './windows-shim'

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
      // npm shims on Windows are .cmd files; they are started without a shell, or not at all.
      const launch = process.platform === 'win32' ? scriptLaunch(command, args) : { command, args }
      if (!launch)
        return resolve({ stdout: '', code: 1 })
      // npm-installed CLIs are `#!/usr/bin/env node` scripts: put their own bin dir (where node lives for nvm/fnm) first.
      const env = { ...withSearchTools({ ...process.env }, dirname(command), process.platform), NO_COLOR: '1', CI: '1' }
      execFile(launch.command, launch.args, { timeout: 8000, windowsHide: true, windowsVerbatimArguments: launch.verbatim, env }, (error, stdout, stderr) => {
        // Some CLIs (codex login status) report on stderr.
        resolve({ stdout: `${stdout ?? ''}${stderr ?? ''}`, code: error ? (typeof error.code === 'number' ? error.code : 1) : 0 })
      })
    }),
  }
}
