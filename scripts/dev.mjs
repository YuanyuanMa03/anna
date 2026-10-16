import { spawn } from 'node:child_process'
import { once } from 'node:events'
import process from 'node:process'
import { createServer } from 'vite'

const compile = spawn(process.execPath, ['scripts/build-host.mjs'], { stdio: 'inherit' })
const [code] = await once(compile, 'exit')
if (code !== 0)
  process.exit(Number(code))
const server = await createServer()
await server.listen()
const electron = (await import('electron')).default
const child = spawn(electron, ['dist/host/apps/desktop/main.js'], { stdio: 'inherit', env: { ...process.env, ANNA_DEV_URL: 'http://127.0.0.1:5193', ANNA_ROOT: process.cwd() } })
let closing = false
async function close() {
  if (closing)
    return; closing = true; child.kill('SIGTERM'); await server.close()
}
process.on('SIGINT', close)
process.on('SIGTERM', close)
child.on('exit', async (code) => { await server.close(); process.exit(code ?? 0) })
