import { defineConfig } from 'vitest/config'

// Several tests start real processes (git fixtures, the push hook, fake agents). On a loaded machine they take more
// than vitest's 5 s default without anything being wrong, so the limit is set where a real hang still shows.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], testTimeout: 20_000 } })
