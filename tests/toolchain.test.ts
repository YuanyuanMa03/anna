import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json')) as {
  packageManager: string
  devEngines: { runtime: { name: string, version: string, onFail: string } }
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}
const workflows = readdirSync(new URL('../.github/workflows/', import.meta.url)).map(name => read(`.github/workflows/${name}`))

describe('every machine builds Anna with the same tools', () => {
  it('pins one exact Node, which pnpm fetches by itself', () => {
    expect(pkg.devEngines.runtime).toMatchObject({ name: 'node', onFail: 'download' })
    expect(pkg.devEngines.runtime.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(read('.nvmrc').trim()).toBe(pkg.devEngines.runtime.version)
  })

  it('pins one exact pnpm', () => {
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/)
  })

  it('declares every dependency at an exact version', () => {
    const floating = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([, version]) => !/^\d+\.\d+\.\d+/.test(version))
    expect(floating).toEqual([])
  })

  it('takes Node and pnpm in CI from those same files', () => {
    for (const workflow of workflows) {
      expect(workflow).toContain('node-version-file: .nvmrc')
      expect(workflow).not.toMatch(/node-version: /)
      expect(workflow).not.toMatch(/pnpm\/action-setup@\S[^\n]*\n\s+with:\n\s+version:/)
    }
  })

  it('runs CI on fixed images and fixed action commits', () => {
    for (const workflow of workflows) {
      expect(workflow).not.toMatch(/-latest\b/)
      const actions = [...workflow.matchAll(/uses: (\S+)/g)].map(match => match[1]!)
      expect(actions.length).toBeGreaterThan(0)
      for (const action of actions)
        expect(action).toMatch(/@[0-9a-f]{40}$/)
    }
  })

  it('keeps files that break on CRLF as LF on Windows checkouts', () => {
    const rules = read('.gitattributes')
    for (const pattern of ['*.patch', '*.sh', 'pnpm-lock.yaml'])
      expect(rules).toMatch(new RegExp(`^${pattern.replace('.', '\\.').replace('*', '\\*')}\\s.*eol=lf`, 'm'))
  })
})
