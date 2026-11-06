export function binaryKind(bytes: Uint8Array): string
export function checkPackage(platform: 'win32' | 'linux', app: string, version: string): Promise<{ problems: string[], stats: Record<string, number> }>
