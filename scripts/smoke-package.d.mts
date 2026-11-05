export function packagedExecutable(platform: NodeJS.Platform, root: string, joinPath?: (...parts: string[]) => string): string
export function startupState(log: string): 'waiting' | 'ready' | 'failed'
