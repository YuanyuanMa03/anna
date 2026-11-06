import type { ModelSettings } from '../shared/contracts'
import type { BenchmarkCase } from './execution'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkCase, PiMeasurements } from './execution'

/** Load each checkout's own Host and kernel. The subscription observes SDK events only. */
export async function runPiCase(source: string, item: BenchmarkCase, workspace: string, data: string, model: ModelSettings, key: string) {
  const { Host } = await import(pathToFileURL(join(source, 'packages/anna-host/host.ts')).href) as typeof import('../anna-host/host')
  const { createPiKernel } = await import(pathToFileURL(join(source, 'packages/kernels/pi/kernel.ts')).href) as typeof import('../kernels/pi/kernel')
  await mkdir(data)
  await writeFile(join(data, 'settings.json'), JSON.stringify({ version: 2, kernel: 'pi', characterId: 'haru', statusEnabled: true, memoryEnabled: true, reviewDelegations: true, model, workspace, workspaces: { [workspace]: { trusted: true, mode: 'edit', rules: { allow: [], ask: [], deny: [] } } } }))
  const measured = new PiMeasurements()
  let actualModel: string | undefined
  const host = new Host(source, data, { read: async () => key, write: async () => {} }, (event) => {
    if (event.type === 'collaborator' && event.state === 'running')
      measured.delegated = true
    if (event.type === 'snapshot') {
      // Both groups reject escalated actions: only fixture-local edits/tests run unattended.
      for (const question of event.snapshot.approvals)
        queueMicrotask(() => { void host.execute({ type: 'approval', id: question.id, allow: false }).catch(() => {}) })
    }
  }, {
    kernel: (context) => {
      const kernel = createPiKernel({ ...context, emit: (event) => {
        if (event.type === 'retrying' || (event.type === 'failover' && event.retry))
          measured.retries++
        context.emit(event)
      } })
      const start = kernel.start.bind(kernel)
      kernel.start = async () => {
        await start()
        actualModel = kernel.modelInfo?.id
        // The SDK session is private in production; this read-only hook keeps baseline source untouched.
        const session = (kernel as unknown as { session?: { subscribe: (listener: (event: { type: string, message?: Parameters<PiMeasurements['message']>[0] }) => void) => () => void } }).session
        if (!session)
          throw new Error('该版本无法提供原始 Pi 测量事件')
        session.subscribe((event) => {
          if (event.type === 'message_end' && event.message)
            measured.message(event.message)
        })
      }
      return kernel
    },
  })
  const started = Date.now()
  const timer = setTimeout(() => { void host.execute({ type: 'stop' }) }, 300_000)
  try {
    await host.initialize()
    await host.execute({ type: 'send', text: item.prompt })
    const snapshot = host.snapshot()
    const elapsedMs = Date.now() - started
    const checked = await checkCase(item, workspace)
    return { ...checked, success: checked.success && snapshot.result?.ok === true, usage: measured.usage, elapsedMs, retries: measured.retries, answer: (snapshot.messages ?? []).filter(message => message.role === 'assistant').map(message => message.text).join('\n\n'), actualModel }
  }
  finally {
    clearTimeout(timer)
    await host.close()
  }
}
