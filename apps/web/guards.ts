import { randomBytes } from 'node:crypto'
import { BlockList, isIP } from 'node:net'
import { join, resolve, sep } from 'node:path'

/** The online demo's front-door rules, kept apart from the server so each can be tried the way a hostile visitor would. */

/**
 * A new visitor's folder. Its name is random and unrelated to the session token: a neighbour can read folder paths
 * from `ps` (the sandbox passes them on bwrap's command line), and the token is what opens the session.
 */
export function sessionDirectory(root: string) {
  return join(root, randomBytes(16).toString('hex'))
}

/** Addresses only a proxy inside the platform's network can have: a hop on the way in, never a visitor. */
const internal = new BlockList()
for (const [network, prefix] of [['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]] as const)
  internal.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of [['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const)
  internal.addSubnet(network, prefix, 'ipv6')
const isInternal = (address: string) => isIP(address) !== 0 && internal.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4')

/**
 * The client's address. Proxies append on the right, so the client is the rightmost X-Forwarded-For entry outside the
 * platform's network; entries to its left are whatever the client sent. `publicProxies` is how many proxies with public
 * addresses stand in front of the Studio: they look like clients, so only the deploy can say to skip them.
 */
export function clientAddress(forwardedFor: string | undefined, socketAddress: string | undefined, publicProxies = 0) {
  const hops = (forwardedFor ?? '').split(',').map(hop => hop.trim()).filter(Boolean)
  const outside = hops.filter(hop => !isInternal(hop))
  return outside.at(-1 - publicProxies) ?? outside[0] ?? hops.at(-1) ?? socketAddress ?? 'unknown'
}

/** Reject a broken deployment setting rather than silently disabling a limit through NaN. */
export function limitSetting(name: string, value: string | undefined, fallback: number, minimum = 1) {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum)
    throw new Error(`${name} must be an integer >= ${minimum}`)
  return parsed
}

/**
 * The sessions each client holds, so one address can't take every slot. `take` hands back the way to give the slot up,
 * or nothing when the client has its share. Several paths can end a session; the slot frees once.
 */
export class ClientSlots {
  private held = new Map<string, number>()
  constructor(private limit: number) {}

  take(client: string) {
    const count = this.held.get(client) ?? 0
    if (count >= this.limit)
      return undefined
    this.held.set(client, count + 1)
    let released = false
    return () => {
      if (released)
        return
      released = true
      const left = this.held.get(client)! - 1
      if (left > 0)
        this.held.set(client, left)
      else this.held.delete(client)
    }
  }
}

/**
 * Whether a request may open a session. Browsers say where a request comes from and pages can't change it, so another
 * site's page can't spend our slots through its visitors' browsers. Nothing else can be told apart here: a script
 * writes what it likes, and it meets the per-client limits instead.
 */
export function allowsNewSession(fetchSite: string | undefined) {
  return fetchSite === undefined || fetchSite === 'same-origin'
}

/**
 * How long a session may sit idle. A page reconnects within seconds, so a session no tab has open has most likely been
 * left behind, and its slot goes back sooner.
 */
export function idleLimit(openTabs: number) {
  return openTabs > 0 ? 2 * 60 * 60 * 1000 : 30 * 60 * 1000
}

/** The largest answer one relayed call may ask for; the free quota is shared by every visitor. */
export const relayMaxTokens = 16384

export type RelayLimit = 'minute' | 'client-day' | 'day'

/** The day's number in Beijing, where the free quota's day is assumed to turn over. */
const beijingDay = (now: number) => Math.floor((now + 8 * 3_600_000) / 86_400_000)

/**
 * Every visitor draws on one free model quota, so per-session throttling can't protect it: one client with a few
 * sessions could spend the day's quota for everybody. This caps all visitors together, per minute and per day, and
 * each client's share of the day.
 */
export class RelayBudget {
  private recent: number[] = []
  private day = 0
  private today = 0
  private clients = new Map<string, number>()
  constructor(private limits: { perMinute: number, perClientPerDay: number, perDay: number }) {}

  private turnOver(now: number) {
    if (beijingDay(now) === this.day)
      return
    this.day = beijingDay(now)
    this.today = 0
    this.clients.clear()
  }

  /** Counts one call for this client, or names the limit it would pass. A refused call costs nothing. */
  take(client: string, now = Date.now()): RelayLimit | undefined {
    this.turnOver(now)
    if (this.today >= this.limits.perDay)
      return 'day'
    if ((this.clients.get(client) ?? 0) >= this.limits.perClientPerDay)
      return 'client-day'
    this.recent = this.recent.filter(t => now - t < 60000)
    if (this.recent.length >= this.limits.perMinute)
      return 'minute'
    this.recent.push(now)
    this.today++
    this.clients.set(client, (this.clients.get(client) ?? 0) + 1)
    return undefined
  }

  /** Whether this client has no calls left today. */
  out(client: string, now = Date.now()) {
    this.turnOver(now)
    return this.today >= this.limits.perDay || (this.clients.get(client) ?? 0) >= this.limits.perClientPerDay
  }
}

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
