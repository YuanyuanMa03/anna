import { ESLint } from 'eslint'
import { expect, it } from 'vitest'

// These folders exist only on the owner's machine and are not part of the app, so they must not fail `pnpm lint` there.
it.each(['materials/promo/tools/launch.mjs', 'demos/anna-3d/main.js', '.remember/now.md'])('lint skips the local file %s', async (path) => {
  expect(await new ESLint().isPathIgnored(path)).toBe(true)
}, 60_000)

it('lint still covers the app', async () => {
  expect(await new ESLint().isPathIgnored('packages/shared/platform.ts')).toBe(false)
}, 60_000)
