import type { Context } from '@deepseek-ai/cordis'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'anna-status'
export const version = '1.0.0'
export const inject = ['tools']
/** This read-only tool uses host-owned files and active Cordis receipts. It exposes no credentials or paths. */
export function apply(ctx: Context, config: { receiptDir: string, statePath: string, packagePath: string, runtimePackagePath: string }) {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'anna_status',
    description: 'Read Anna version, DSH version, current character and actually loaded Anna plugins.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      const host = JSON.parse(readFileSync(config.statePath, 'utf8')) as { characterId: string }
      const anna = JSON.parse(readFileSync(config.packagePath, 'utf8')) as { version: string }
      const dsh = JSON.parse(readFileSync(config.runtimePackagePath, 'utf8')) as { version: string }
      const plugins = readdirSync(config.receiptDir).filter(file => file.endsWith('.json')).map((file) => {
        const receipt = JSON.parse(readFileSync(join(config.receiptDir, file), 'utf8')) as { id: string, pid: number }
        if (receipt.pid !== process.pid)
          throw new Error('Stale plugin receipt')
        return receipt.id
      })
      return JSON.stringify({ annaVersion: anna.version, dshVersion: dsh.version, characterId: host.characterId, plugins, tools: ctx.tools.schemas().map(tool => tool.name) })
    },
  })))
  ctx.effect(() => {
    const path = join(config.receiptDir, `${name}.json`)
    writeFileSync(path, JSON.stringify({ id: name, version, pid: process.pid, tools: ctx.tools.schemas().map(tool => tool.name) }))
    return () => rmSync(path, { force: true })
  })
}
