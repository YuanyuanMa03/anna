import { build as bundle } from 'esbuild'
import { build } from 'vite'

await build({ configFile: 'vite.config.ts', mode: 'web', define: { 'import.meta.env.VITE_ANNA_WEB': 'true' }, build: { outDir: '../../dist/web' } })
// The server and each visitor's core process; dependencies stay in node_modules.
for (const [entry, outfile] of [['apps/web/server.ts', 'dist/web-server.js'], ['apps/web/core.ts', 'dist/web-core.js']])
  await bundle({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', sourcemap: true })
