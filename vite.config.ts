import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig(({ command }) => {
  // Anna's own body is her original art and is not published: a build carries it only when asked to
  // (ANNA_WITH_BODY=1, for the owner's own machine), never by default. The dev server uses it when it is in place.
  const body = existsSync(resolve('assets/anna-body/anna.mavatar')) && (command === 'serve' || process.env.ANNA_WITH_BODY === '1')
  let outDir = ''
  return {
    root: 'apps/desktop',
    base: './',
    publicDir: resolve('assets'),
    define: { __ANNA_BODY__: JSON.stringify(body) },
    plugins: [vue(), {
      name: 'anna-body-stays-home',
      configResolved(config) { outDir = resolve(config.root, config.build.outDir) },
      // The runtime unpacks her archive into blob: URLs and fetches them; without her body the policy stays as it was.
      transformIndexHtml(html) {
        if (!body)
          return html
        if (!html.includes('connect-src \'self\''))
          throw new Error('index.html has no connect-src \'self\' to extend with blob: for Anna\'s body')
        return html.replace('connect-src \'self\'', 'connect-src \'self\' blob:')
      },
      // publicDir copies all of assets/; take her body out again wherever this build writes (desktop, web, --outDir).
      closeBundle() {
        if (command === 'build' && !body)
          rmSync(resolve(outDir, 'anna-body'), { recursive: true, force: true })
      },
    }],
    server: { host: '127.0.0.1', port: 5193, strictPort: true },
    build: { outDir: '../../dist/renderer', emptyOutDir: true },
  }
})
