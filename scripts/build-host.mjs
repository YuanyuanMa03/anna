import { spawn } from 'node:child_process'
import { once } from 'node:events'
import process from 'node:process'
import { build } from 'esbuild'

const child = spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', 'tsc', '-p', 'tsconfig.host.json'], { stdio: 'inherit', shell: process.platform === 'win32' })
const [code] = await once(child, 'exit')
if (code)
  process.exit(Number(code))
await build({ entryPoints: ['apps/desktop/preload.ts'], outfile: 'dist/host/apps/desktop/preload.cjs', bundle: true, platform: 'browser', format: 'cjs', external: ['electron'] })
// Main (window, menus, credential store) and core (kernel, permissions, channels) are separate processes.
for (const entry of ['main', 'core'])
  await build({ entryPoints: [`apps/desktop/${entry}.ts`], outfile: `dist/host/apps/desktop/${entry}.js`, bundle: true, platform: 'node', format: 'esm', packages: 'external', sourcemap: true })
