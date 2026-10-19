import { Buffer } from 'node:buffer'
import { createPrivateKey, sign } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { manifestPayload } from './manifest-payload.mjs'

/**
 * Sign latest.json in place with the release key (see release-keygen.mjs), after its assets are final: CI writes it
 * unsigned, and the release machine patches the mac zip's sha256, then signs. The in-app updater refuses an unsigned
 * or altered manifest.
 * Usage: node scripts/sign-manifest.mjs [latest.json]   (key: $ANNA_RELEASE_SIGNING_KEY or ~/.config/anna/release-signing.pem)
 */
const file = process.argv[2] ?? 'website/public/latest.json'
const keyPath = process.env.ANNA_RELEASE_SIGNING_KEY ?? join(homedir(), '.config/anna/release-signing.pem')
const manifest = JSON.parse(await readFile(file, 'utf8'))
const key = createPrivateKey(await readFile(keyPath, 'utf8'))
const signature = sign(null, Buffer.from(manifestPayload(manifest)), key).toString('base64')
// One asset per line, as install.sh reads it; the signature on a line of its own.
const lines = Object.keys(manifest.assets).sort().map(name => `    ${JSON.stringify(name)}: { "url": ${JSON.stringify(manifest.assets[name].url)}, "sha256": "${manifest.assets[name].sha256.toLowerCase()}" }`)
const text = `{\n  "version": ${JSON.stringify(manifest.version)},\n  "notes": ${JSON.stringify(manifest.notes ?? '')},\n  "assets": {\n${lines.join(',\n')}\n  },\n  "signature": ${JSON.stringify(signature)}\n}\n`
JSON.parse(text)
await writeFile(file, text)
console.log(`signed ${file} (${manifest.version})`)
