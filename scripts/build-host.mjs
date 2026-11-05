import { rm, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { runPnpm } from './run-pnpm.mjs'

await rm('dist/host', { recursive: true, force: true })
runPnpm(['exec', 'tsc', '-p', 'tsconfig.host.json'])
await build({ entryPoints: ['apps/desktop/preload.ts'], outfile: 'dist/host/apps/desktop/preload.cjs', bundle: true, platform: 'browser', format: 'cjs', external: ['electron'] })
// Main (window, menus, credential store) and core (kernel, permissions, channels) are separate processes.
const dependencies = new Set()
for (const entry of ['main', 'core']) {
  const result = await build({ entryPoints: [`apps/desktop/${entry}.ts`], outfile: `dist/host/apps/desktop/${entry}.js`, bundle: true, platform: 'node', format: 'esm', packages: 'external', sourcemap: true, metafile: true })
  for (const output of Object.values(result.metafile.outputs)) {
    for (const dependency of output.imports) {
      if (dependency.external && !dependency.path.startsWith('node:') && dependency.path !== 'electron')
        dependencies.add(dependency.path)
    }
  }
}
await writeFile('dist/host/runtime-dependencies.json', JSON.stringify([...dependencies].sort(), null, 2))
