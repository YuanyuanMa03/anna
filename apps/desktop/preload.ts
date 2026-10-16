import type { AnnaBridge, AnnaEvent, Command } from '../../packages/shared/contracts'
import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { contextBridge, ipcRenderer } from 'electron'
import { command, runtimeEvent } from '../../packages/shared/contracts'

const { context } = createContext(ipcRenderer)
const invoke = defineInvoke(context, command)
const listeners = new Set<(event: AnnaEvent) => void>()
context.on(runtimeEvent, ({ body }) => { for (const listener of listeners) body && listener(body) })
const bridge: AnnaBridge = {
  invoke: (request: Command) => invoke({ command: request }),
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
}
contextBridge.exposeInMainWorld('anna', bridge)
