import { randomBytes } from 'node:crypto'
import { join, resolve, sep } from 'node:path'

/** The online demo's front-door rules, kept apart from the server so each can be tried the way a hostile visitor would. */

/**
 * A new visitor's folder. Its name is random and unrelated to the session token: a neighbour can read folder paths
 * from `ps` (the sandbox passes them on bwrap's command line), and the token is what opens the session.
 */
export function sessionDirectory(root: string) {
  return join(root, randomBytes(16).toString('hex'))
}

/**
 * The client's address: the rightmost X-Forwarded-For entry, the one the Studio's own proxy appended. Entries to its
 * left are whatever the client sent.
 */
export function clientAddress(forwardedFor: string | undefined, socketAddress: string | undefined) {
  const hops = (forwardedFor ?? '').split(',').map(hop => hop.trim()).filter(Boolean)
  return hops.at(-1) || socketAddress || 'unknown'
}

/** The largest answer one relayed call may ask for; the free quota is shared by every visitor. */
export const relayMaxTokens = 16384

/** A relayed chat request asks for one answer of bounded length, whatever the visitor's own programs send. */
export function capRelayBody(body: Record<string, unknown>) {
  const { best_of: _bestOf, ...rest } = body
  const capped: Record<string, unknown> = { ...rest }
  if ('n' in capped)
    capped.n = 1
  for (const field of ['max_tokens', 'max_completion_tokens']) {
    if (field in capped)
      capped[field] = Math.min(Math.max(1, Number(capped[field]) || relayMaxTokens), relayMaxTokens)
  }
  return capped
}

/** The file a GET for `pathname` serves: inside `root`, never a hidden file, decoded before it is checked. */
export function staticFile(root: string, pathname: string) {
  let decoded: string
  try { decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname) }
  catch { return undefined }
  if (decoded.includes('\0') || decoded.split('/').some(part => part.startsWith('.')))
    return undefined
  const path = resolve(root, `.${decoded}`)
  return path.startsWith(`${resolve(root)}${sep}`) ? path : undefined
}

/**
 * Unix users for visitors, handed out in rotation: a released uid goes to the back of the line, so whatever a closed
 * visitor left behind (a process that outlived the kill, a file in /tmp) never belongs to the next one.
 */
export class UidPool {
  private next: number
  private inUse = new Set<number>()
  constructor(private first: number, private last: number) { this.next = first }

  take() {
    for (let tries = 0; tries <= this.last - this.first; tries++) {
      const uid = this.next
      this.next = uid >= this.last ? this.first : uid + 1
      if (!this.inUse.has(uid)) {
        this.inUse.add(uid)
        return uid
      }
    }
    return undefined
  }

  release(uid: number) { this.inUse.delete(uid) }
}
