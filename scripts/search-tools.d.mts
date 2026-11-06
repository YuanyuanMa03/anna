export interface SearchToolAsset { tool: string, name: string, url: string, sha256: string }
export function searchToolAssets(platform: string, arch: string): SearchToolAsset[]
export function stageSearchTools(resources: string, platform: string, options: { arch: string, assets?: SearchToolAsset[], cache?: string, request?: typeof fetch }): Promise<string[]>
