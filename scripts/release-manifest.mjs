import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import process from 'node:process'

/**
 * Write website/public/latest.json for install.sh / install.ps1 and the in-app updater.
 * Usage: node scripts/release-manifest.mjs <download base URL> darwin-arm64=dist/macos/Anna-0.4.0-mac-arm64.zip win32-x64=… linux-x64=…
 * One asset per line, so install.sh can read it without jq.
 */
const [base, ...pairs] = process.argv.slice(2)
if (!base?.startsWith('https://') || !pairs.length)
  throw new Error('usage: node scripts/release-manifest.mjs https://…/download/vX.Y.Z key=path …')
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const notes = process.env.ANNA_RELEASE_NOTES ?? ''
const lines = []
for (const pair of pairs) {
  const [key, path] = pair.split('=')
  const sha256 = createHash('sha256').update(await readFile(path)).digest('hex')
  lines.push(`    ${JSON.stringify(key)}: { "url": ${JSON.stringify(`${base.replace(/\/$/, '')}/${basename(path)}`)}, "sha256": "${sha256}" }`)
}
const text = `{\n  "version": ${JSON.stringify(version)},\n  "notes": ${JSON.stringify(notes)},\n  "assets": {\n${lines.join(',\n')}\n  }\n}\n`
JSON.parse(text)
await writeFile('website/public/latest.json', text)
console.log(text)
