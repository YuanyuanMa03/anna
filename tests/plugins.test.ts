import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import * as persona from '../plugins/anna-persona'
import * as status from '../plugins/anna-status'

describe('cordis plugin lifecycle', () => {
  it('registers real persona and tool contributions and removes their effects on disposal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anna-plugins-'))
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      const p = await ctx.plugin(persona, { promptPath: resolve('plugins/anna-persona/persona.md'), receiptDir: dir })
      const tool = await ctx.plugin(status, { receiptDir: dir, statePath: join(dir, 'state.json'), packagePath: resolve('package.json'), runtimePackagePath: resolve('node_modules/@deepseek-ai/dsh/package.json') })
      expect(ctx.tools.schemas().map(t => t.name)).toEqual(['anna_status'])
      const assembly = await ctx.systemPrompt.assemble()
      expect(assembly.sections.some(s => s.name === 'anna-persona' && s.text.includes('善良'))).toBe(true)
      await tool.dispose()
      expect(ctx.tools.schemas()).toEqual([])
      const recomposed = await ctx.systemPrompt.assemble()
      expect(recomposed.sections.find(s => s.name === 'anna-persona')?.text).toContain('本轮实际注册的工具清单：无')
      const receipt = JSON.parse(await readFile(join(dir, 'anna-persona.json'), 'utf8'))
      expect(receipt.tools).toEqual([])
      const again = await ctx.plugin(status, { receiptDir: dir, statePath: '', packagePath: '', runtimePackagePath: '' })
      expect(ctx.tools.schemas().map(t => t.name)).toEqual(['anna_status'])
      await again.dispose()
      await p.dispose()
      expect((await ctx.systemPrompt.assemble()).sections.some(s => s.name === 'anna-persona')).toBe(false)
      await expect(readFile(join(dir, 'anna-persona.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      await writeFile(join(dir, 'sentinel'), 'synthetic lifecycle validation')
    }
    finally { await ctx.fiber.dispose(); await rm(dir, { recursive: true, force: true }) }
  })
})
