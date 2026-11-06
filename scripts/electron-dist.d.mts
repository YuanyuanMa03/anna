export function artifactName(platform: string, arch: string, version: string): string
export function artifactUrl(name: string, version: string, env?: Record<string, string | undefined>): string
export function verifyArtifact(bytes: Uint8Array, name: string, checksums: Record<string, string>): void
export function electronDist(platform: string, arch: string): Promise<string>
export function zipFolder(parent: string, folder: string, output: string): void
export function sha256(path: string): Promise<string>
export function unzip(archive: string, destination: string): void
export function systemTar(): string
