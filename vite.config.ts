import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'apps/desktop',
  base: './',
  publicDir: resolve('assets'),
  plugins: [vue()],
  server: { host: '127.0.0.1', port: 5193, strictPort: true },
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
})
