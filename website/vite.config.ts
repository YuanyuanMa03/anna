import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), plugins: [vue()], build: { outDir: 'dist', emptyOutDir: true } })
