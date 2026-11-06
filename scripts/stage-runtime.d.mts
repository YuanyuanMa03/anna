export const unpackedFiles: string
export function longestPath(root: string): Promise<number>
export function stageDependencies(root: string, destination: string, names: string[], omit?: Set<string>): Promise<number>
export function stageRuntime(root: string, resources: string): Promise<{ dependencyCount: number, externalDependencyCount: number, runtimeDependencies: string[], archive: string }>
