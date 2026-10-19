import { build as bundle } from 'esbuild'
import { build } from 'vite'

await build({ configFile: 'vite.config.ts', mode: 'web', define: { 'import.meta.env.VITE_ANNA_WEB': 'true' }, build: { outDir: '../../dist/web' } })
await bundle({ entryPoints: ['apps/web/server.ts'], outfile: 'dist/web-server.js', bundle: true, platform: 'node', format: 'esm', packages: 'external', sourcemap: true })
