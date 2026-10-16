import { spawn } from 'node:child_process'
import { once } from 'node:events'
import process from 'node:process'
import { build } from 'esbuild'

const child = spawn('pnpm', ['exec', 'tsc', '-p', 'tsconfig.host.json'], { stdio: 'inherit' })
const [code] = await once(child, 'exit')
if (code)
  process.exit(Number(code))
await build({ entryPoints: ['apps/desktop/preload.ts'], outfile: 'dist/host/apps/desktop/preload.cjs', bundle: true, platform: 'browser', format: 'cjs', external: ['electron'] })

await build({ entryPoints: ['apps/desktop/main.ts'], outfile: 'dist/host/apps/desktop/main.js', bundle: true, platform: 'node', format: 'esm', packages: 'external', sourcemap: true })
