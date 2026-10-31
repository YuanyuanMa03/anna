import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig(({ command }) => {
  // Anna's own body is her original art and is not published: a build carries it only when asked to
  // (ANNA_WITH_BODY=1, for the owner's own machine), never by default. The dev server uses it when it is in place.
  const body = existsSync(resolve('assets/anna-body/anna.mavatar')) && (command === 'serve' || process.env.ANNA_WITH_BODY === '1')
  return {
    root: 'apps/desktop',
    base: './',
    publicDir: resolve('assets'),
    define: { __ANNA_BODY__: JSON.stringify(body) },
    plugins: [vue(), {
      name: 'anna-body-stays-home',
      apply: 'build',
      closeBundle() {
        if (!body)
          rmSync(resolve('dist/renderer/anna-body'), { recursive: true, force: true })
      },
    }],
    server: { host: '127.0.0.1', port: 5193, strictPort: true },
    build: { outDir: '../../dist/renderer', emptyOutDir: true },
  }
})
