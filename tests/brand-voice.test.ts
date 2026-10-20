import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copy } from '../website/src/copy'

const root = join(import.meta.dirname, '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

const slogan = { zh: '她在你的桌面上醒来。', en: 'She wakes on your desktop.' }
const subline = { zh: '陪你说话，替你做事，从不说谎。', en: 'She keeps you company, does the work, and never lies to you.' }

describe('brand voice', () => {
  it('opens both READMEs with the slogan and its subline', () => {
    const en = read('README.md')
    const zh = read('README.zh-CN.md')
    expect(en).toContain(`**${slogan.en}**`)
    expect(en).toContain(subline.en)
    expect(zh).toContain(`**${slogan.zh}**`)
    expect(zh).toContain(subline.zh)
  })

  it('uses the slogan in the website hero, title and footer', () => {
    expect(copy.zh.hero.title.join('')).toBe(slogan.zh)
    expect(copy.en.hero.title.join(' ')).toBe(slogan.en)
    expect(copy.zh.meta.title).toBe(`Anna · ${slogan.zh.replace(/。$/, '')}`)
    expect(copy.en.meta.title).toBe(`Anna · ${slogan.en.replace(/\.$/, '')}`)
    expect(copy.zh.footer.tagline).toBe(`${slogan.zh}${subline.zh}`)
    expect(copy.en.footer.tagline).toBe(`${slogan.en} ${subline.en}`)

    const html = read('website/index.html')
    expect(html).toContain(`<title>${copy.zh.meta.title}</title>`)
    expect(html).toContain(`<meta property="og:title" content="${copy.en.meta.title}">`)
  })

  it('shows the slogan in the Linux menu and says plainly what the package is', () => {
    const deb = read('scripts/package-deb.mjs')
    expect(deb).toContain(`Comment=${slogan.en.replace(/\.$/, '')}\n`)
    expect(deb).toContain('Description: Live2D desktop companion who codes alongside you')
  })

  it('leaves the old slogan behind everywhere it was shown', () => {
    const surfaces = ['README.md', 'README.zh-CN.md', 'website/index.html', 'website/src/copy.ts', 'scripts/package-deb.mjs']
    for (const path of surfaces) {
      const text = read(path)
      expect(text, path).not.toMatch(/honest companion|真诚伙伴/)
    }
  })

  it('links the comparison in both languages from both READMEs', () => {
    expect(read('README.md')).toContain('](docs/comparison.md)')
    expect(read('README.zh-CN.md')).toContain('](docs/comparison.zh-CN.md)')
    expect(read('docs/comparison.md')).toContain('](comparison.zh-CN.md)')
    expect(read('docs/comparison.zh-CN.md')).toContain('](comparison.md)')
  })
})
