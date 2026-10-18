import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/**
 * The desktop acceptance scripts run the built renderer, which carries the Live2D assets only if they were in place
 * at build time (they stay out of Git). Without them the stage never loads, and the script would just time out.
 */
export function assertBuiltAssets(root = process.cwd()) {
  const missing = ['live2dcubismcore.min.js', 'characters'].filter(name => !existsSync(join(root, 'dist/renderer', name)))
  if (missing.length > 0)
    throw new Error(`The build has no Live2D assets (dist/renderer is missing ${missing.join(', ')}). Run \`pnpm build\` again: it fetches them first.`)
}
