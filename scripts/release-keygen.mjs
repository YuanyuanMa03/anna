import { generateKeyPairSync } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'

/**
 * Create the Ed25519 key that signs latest.json (once). The private key stays on the release machine, outside the
 * repository; the public key it prints goes into packages/shared/update.ts (`releasePublicKey`), so the in-app updater
 * only installs releases signed with it. Back the private key up: without it, no update can be published.
 * Usage: node scripts/release-keygen.mjs [path]   (default: $ANNA_RELEASE_SIGNING_KEY or ~/.config/anna/release-signing.pem)
 */
const path = process.argv[2] ?? process.env.ANNA_RELEASE_SIGNING_KEY ?? join(homedir(), '.config/anna/release-signing.pem')
if (existsSync(path))
  throw new Error(`${path} already exists; refusing to replace a release key`)
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
await mkdir(dirname(path), { recursive: true, mode: 0o700 })
await writeFile(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
console.log(`private key: ${path} (keep it; back it up)`)
console.log(`public key (releasePublicKey): ${publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`)
