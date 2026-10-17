import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)
const script = resolve('website/public/install.sh')

/** A release directory with a fake Anna.app zip and a latest.json pointing at it through file://. */
async function release(corruptChecksum = false) {
  const root = await mkdtemp(join(tmpdir(), 'anna-install-'))
  const app = join(root, 'build', 'Anna.app', 'Contents')
  await mkdir(join(app, 'MacOS'), { recursive: true })
  await writeFile(join(app, 'Info.plist'), '<plist><dict><key>CFBundleShortVersionString</key><string>0.5.0</string></dict></plist>')
  await writeFile(join(app, 'MacOS', 'Anna'), '#!/bin/sh\n', { mode: 0o755 })
  await mkdir(join(root, 'release'))
  const zip = join(root, 'release', 'Anna-0.5.0-mac-arm64.zip')
  await run('/usr/bin/ditto', ['-c', '-k', '--keepParent', join(root, 'build', 'Anna.app'), zip])
  const sha = corruptChecksum ? 'f'.repeat(64) : createHash('sha256').update(await readFile(zip)).digest('hex')
  await writeFile(join(root, 'release', 'latest.json'), `{\n  "version": "0.5.0",\n  "assets": {\n    "darwin-arm64": { "url": "file://${zip}", "sha256": "${sha}" },\n    "darwin-x64": { "url": "file://${zip}", "sha256": "${sha}" }\n  }\n}\n`)
  const home = join(root, 'home')
  await mkdir(home)
  // Users run this in UTF-8 locales, where bash 3.2 reads multibyte characters as part of a variable name.
  return { root, home, env: { ...process.env, LC_ALL: 'zh_CN.UTF-8', LANG: 'zh_CN.UTF-8', HOME: home, ANNA_RELEASE_BASE: `file://${join(root, 'release')}`, ANNA_INSTALL_ALLOW_FILE: '1', ANNA_INSTALL_NO_OPEN: '1' } }
}

describe.skipIf(process.platform !== 'darwin')('install.sh on macOS', () => {
  it('downloads, verifies and installs Anna.app into ~/Applications without quarantine', async () => {
    const { home, env } = await release()
    const { stdout } = await run('/bin/bash', [script], { env })
    expect(stdout).toContain('Anna 0.5.0')
    expect(existsSync(join(home, 'Applications', 'Anna.app', 'Contents', 'MacOS', 'Anna'))).toBe(true)
    const { stdout: attrs } = await run('/usr/bin/xattr', ['-r', join(home, 'Applications', 'Anna.app')])
    expect(attrs).not.toContain('com.apple.quarantine')
  })
  it('refuses a download whose checksum does not match and installs nothing', async () => {
    const { home, env } = await release(true)
    await expect(run('/bin/bash', [script], { env })).rejects.toMatchObject({ stderr: expect.stringContaining('校验失败') })
    expect(existsSync(join(home, 'Applications', 'Anna.app'))).toBe(false)
  })
})

describe('shell scripts survive UTF-8 locales', () => {
  it('never put a bare $VAR directly before non-ASCII text (bash would read it as part of the name)', async () => {
    const { readFile, readdir } = await import('node:fs/promises')
    const scripts = ['website/public/install.sh', ...(await readdir('scripts')).filter(name => name.endsWith('.sh')).map(name => `scripts/${name}`)]
    const offenders: string[] = []
    for (const script of scripts) {
      (await readFile(script, 'utf8')).split('\n').forEach((line, index) => {
        for (const match of line.matchAll(/\$[A-Z_]\w*/gi)) {
          const next = line.charCodeAt((match.index ?? 0) + match[0].length)
          if (next > 127)
            offenders.push(`${script}:${index + 1}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
