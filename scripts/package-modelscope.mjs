import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

const output = resolve(process.argv[2] ?? 'artifacts/modelscope')
await mkdir(output, { recursive: true })
const source = JSON.parse(await readFile('package.json', 'utf8'))
const runtime = { name: source.name, version: source.version, type: source.type, private: true, scripts: { start: 'node dist/web-server.js' }, dependencies: source.dependencies }
await writeFile(`${output}/package.json`, `${JSON.stringify(runtime, null, 2)}\n`)
for (const name of ['LICENSE', 'NOTICE.md', 'COMMERCIAL.md']) await cp(name, `${output}/${name}`)
for (const name of ['Dockerfile', 'README.md']) await cp(`deploy/modelscope/${name}`, `${output}/${name}`)
await cp('dist/web', `${output}/dist/web`, { recursive: true })
await cp('dist/web-server.js', `${output}/dist/web-server.js`)
await cp('dist/web-server.js.map', `${output}/dist/web-server.js.map`)
await cp('dist/web-core.js', `${output}/dist/web-core.js`)
await cp('dist/web-core.js.map', `${output}/dist/web-core.js.map`)
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
await writeFile(`${output}/DEPLOYMENT.md`, `# Deployment provenance\n\nSource repository: https://github.com/YuanyuanMa03/anna\nSource commit: ${commit}\nBuild: pnpm build:web\nPackage: node scripts/package-modelscope.mjs\n\nRuntime: Node.js 24, 0.0.0.0:7860; free ModelScope CPU; one Anna process and Unix user per visitor; command sandbox via bubblewrap; session expires after 2 idle hours.\n\nThe ModelScope key is provided only through Studio Secrets and stays in the server process; visitors reach the model through a loopback relay. No fake model responses.\n`)
execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--omit=dev', '--prefix', output], { stdio: 'inherit' })
