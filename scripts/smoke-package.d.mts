export function packagedExecutable(platform: NodeJS.Platform, root: string, joinPath?: (...parts: string[]) => string): string
export function startupState(log: string): 'waiting' | 'ready' | 'failed'
export function bundledTools(platform: NodeJS.Platform, executable: string, paths?: { join: (...parts: string[]) => string, dirname: (path: string) => string }): string[]
