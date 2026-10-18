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
    await expect(run('/bin/bash', [script], { env })).rejects.toMatchObject({ stderr: expect.stringContaining('checksum mismatch') })
    expect(existsSync(join(home, 'Applications', 'Anna.app'))).toBe(false)
  })
})

/** A Linux release whose tar.gz holds Anna/anna, plus fake sudo and apparmor_parser so the AppArmor path runs unprivileged. */
async function linuxRelease() {
  const root = await mkdtemp(join(tmpdir(), 'anna-install-linux-'))
  const app = join(root, 'build', 'Anna')
  await mkdir(app, { recursive: true })
  await writeFile(join(app, 'anna'), '#!/bin/sh\n', { mode: 0o755 })
  await writeFile(join(app, 'anna-bin'), '#!/bin/sh\n', { mode: 0o755 })
  await mkdir(join(root, 'release'))
  const archive = join(root, 'release', 'Anna-0.5.0-linux.tar.gz')
  await run('tar', ['-czf', archive, '-C', join(root, 'build'), 'Anna'])
  const sha = createHash('sha256').update(await readFile(archive)).digest('hex')
  await writeFile(join(root, 'release', 'latest.json'), `{\n  "version": "0.5.0",\n  "assets": {\n    "linux-x64": { "url": "file://${archive}", "sha256": "${sha}" },\n    "linux-arm64": { "url": "file://${archive}", "sha256": "${sha}" }\n  }\n}\n`)
  const tools = join(root, 'tools')
  await mkdir(tools)
  await writeFile(join(tools, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 })
  await writeFile(join(tools, 'apparmor_parser'), `#!/bin/sh\necho "$@" >> ${join(root, 'parsed')}\n`, { mode: 0o755 })
  await writeFile(join(root, 'userns'), '1\n')
  const home = join(root, 'home')
  const apparmor = join(root, 'apparmor.d')
  await mkdir(home)
  await mkdir(apparmor)
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${tools}:${process.env.PATH}`, HOME: home, ANNA_RELEASE_BASE: `file://${join(root, 'release')}`, ANNA_INSTALL_ALLOW_FILE: '1', ANNA_USERNS_SYSCTL: join(root, 'userns'), ANNA_APPARMOR_DIR: apparmor }
  delete env.XDG_DATA_HOME
  delete env.ANNA_INSTALL_APPARMOR
  return { root, home, apparmor, env, dest: join(home, '.local/share/anna-app') }
}

describe.skipIf(process.platform !== 'linux')('install.sh on Linux', () => {
  it('installs into ~/.local/share/anna-app with a launcher command and desktop entry', async () => {
    const { home, apparmor, env, dest } = await linuxRelease()
    const { stdout } = await run('/bin/bash', [script], { env: { ...env, ANNA_USERNS_SYSCTL: '/nonexistent' } })
    expect(stdout).toContain('Anna 0.5.0')
    expect(await readFile(join(home, '.local/bin/anna'), 'utf8')).toBe('#!/bin/sh\n')
    expect(await readFile(join(home, '.local/share/applications/anna.desktop'), 'utf8')).toContain(`Exec=${dest}/anna %U\nIcon=`)
    expect(stdout).not.toContain('AppArmor')
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(apparmor)).toEqual([])
  })
  it('explains the AppArmor opt-in when user namespaces are restricted, without using sudo', async () => {
    const { root, apparmor, env, dest } = await linuxRelease()
    const { stdout } = await run('/bin/bash', [script], { env })
    expect(stdout).toContain('ANNA_INSTALL_APPARMOR=1')
    expect(stdout).toContain(`${dest}/anna-bin`)
    expect(existsSync(join(apparmor, `anna-${process.getuid!()}`))).toBe(false)
    expect(existsSync(join(root, 'parsed'))).toBe(false)
  })
  it('adds and loads an AppArmor profile for anna-bin with ANNA_INSTALL_APPARMOR=1', async () => {
    const { root, apparmor, env, dest } = await linuxRelease()
    const profile = join(apparmor, `anna-${process.getuid!()}`)
    const { stdout } = await run('/bin/bash', [script], { env: { ...env, ANNA_INSTALL_APPARMOR: '1' } })
    expect(stdout).toContain('AppArmor profile added')
    const text = await readFile(profile, 'utf8')
    expect(text).toContain(`"${dest}/anna-bin" flags=(unconfined)`)
    expect(text).toContain('  userns,\n')
    expect(await readFile(join(root, 'parsed'), 'utf8')).toBe(`-r ${profile}\n`)
    // Reinstalling with the same profile leaves it alone.
    const again = await run('/bin/bash', [script], { env: { ...env, ANNA_INSTALL_APPARMOR: '1' } })
    expect(again.stdout).not.toContain('AppArmor')
    expect(await readFile(join(root, 'parsed'), 'utf8')).toBe(`-r ${profile}\n`)
  })
})

/** Runs scripts/linux-launcher.sh against a fake anna-bin that prints its arguments. */
async function launch(options: { unshare: boolean, profile?: boolean }) {
  const root = await mkdtemp(join(tmpdir(), 'anna-launcher-'))
  const app = join(root, 'Anna')
  const tools = join(root, 'tools')
  const apparmor = join(root, 'apparmor.d')
  await mkdir(app)
  await mkdir(tools)
  await mkdir(apparmor)
  await writeFile(join(app, 'anna'), await readFile(resolve('scripts/linux-launcher.sh')), { mode: 0o755 })
  await writeFile(join(app, 'anna-bin'), '#!/bin/sh\necho "$@"\n', { mode: 0o755 })
  await writeFile(join(tools, 'unshare'), `#!/bin/sh\nexit ${options.unshare ? 0 : 1}\n`, { mode: 0o755 })
  if (options.profile) {
    const { realpath } = await import('node:fs/promises')
    await writeFile(join(apparmor, 'anna-1000'), `profile anna-1000 "${await realpath(app)}/anna-bin" flags=(unconfined) {\n  userns,\n}\n`)
  }
  return run(join(app, 'anna'), ['--flag'], { env: { ...process.env, PATH: `${tools}:${process.env.PATH}`, ANNA_APPARMOR_DIR: apparmor } })
}

describe.skipIf(process.platform === 'win32')('the Linux launcher', () => {
  it('keeps the Chromium sandbox when user namespaces work', async () => {
    const { stdout, stderr } = await launch({ unshare: true })
    expect(stdout).toBe('--flag\n')
    expect(stderr).toBe('')
  })
  it('keeps the sandbox when an AppArmor profile grants anna-bin user namespaces', async () => {
    const { stdout } = await launch({ unshare: false, profile: true })
    expect(stdout).toBe('--flag\n')
  })
  it('falls back to --no-sandbox and says how to fix it when user namespaces are blocked', async () => {
    const { stdout, stderr } = await launch({ unshare: false })
    expect(stdout).toBe('--no-sandbox --flag\n')
    expect(stderr).toContain('ANNA_INSTALL_APPARMOR=1')
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
