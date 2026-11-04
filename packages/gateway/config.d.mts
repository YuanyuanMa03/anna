export interface GatewayConfig {
  version: number
  access: 'local' | 'network'
  host: string
  port: number
  backendURL: string
  consolePort: number
  publicURL: string
  allowLocalLLM: boolean
}
export const defaults: GatewayConfig
export function privateHost(host: string): boolean
export function dataDirectory(platform?: string, env?: NodeJS.ProcessEnv, home?: string): string
export function validateConfig(value: unknown): GatewayConfig
export function initialize(directory: string): Promise<void>
export function loadConfig(directory: string): Promise<GatewayConfig>
