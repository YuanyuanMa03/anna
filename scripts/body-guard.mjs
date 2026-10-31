import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/**
 * Packages are for sharing; Anna's own body is her original art and is never published. A build carries it only with
 * ANNA_WITH_BODY=1 (see vite.config.ts), and packaging such a build needs a second, explicit ANNA_PACKAGE_BODY=1.
 */
export function assertNoBody(root = process.cwd()) {
  if (existsSync(join(root, 'dist/renderer/anna-body')) && process.env.ANNA_PACKAGE_BODY !== '1')
    throw new Error('This build carries Anna\'s own body (ANNA_WITH_BODY=1), which must not be published. Unset ANNA_WITH_BODY, or set ANNA_PACKAGE_BODY=1 for a package that stays on your own machines.')
}
