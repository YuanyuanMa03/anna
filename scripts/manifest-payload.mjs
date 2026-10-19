/**
 * The bytes a release signature covers: version, notes and every asset's URL and SHA-256, in a fixed order. Must stay
 * identical to `manifestPayload` in packages/shared/update.ts, which verifies it.
 */
export function manifestPayload(manifest) {
  const assets = Object.fromEntries(Object.keys(manifest.assets).sort().map(name => [name, { url: manifest.assets[name].url, sha256: manifest.assets[name].sha256.toLowerCase() }]))
  return JSON.stringify({ version: manifest.version, notes: manifest.notes ?? '', assets })
}
