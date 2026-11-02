import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allowsNewSession, capRelayBody, clientAddress, ClientSlots, idleLimit, RelayBudget, sessionDirectory, staticFile, UidPool } from '../apps/web/guards'

/** The online demo's front door, tried the way a hostile visitor would. */
describe('the online demo\'s guards', () => {
  it('a session\'s folder is random, not its token, which a neighbour could read from `ps`', () => {
    const dir = sessionDirectory('/tmp/anna-web-sessions')
    expect(dir.startsWith(join('/tmp/anna-web-sessions', sep))).toBe(true)
    expect(sessionDirectory('/tmp/anna-web-sessions')).not.toBe(dir)
  })

  it('the client is the address the Studio\'s proxy saw, not one the client wrote into X-Forwarded-For', () => {
    expect(clientAddress('6.6.6.6, 1.2.3.4', '10.0.0.5')).toBe('1.2.3.4')
    expect(clientAddress('1.2.3.4', '10.0.0.5')).toBe('1.2.3.4')
    expect(clientAddress(undefined, '10.0.0.5')).toBe('10.0.0.5')
  })

  it('proxies inside the Studio\'s network are hops on the way in, not visitors', () => {
    expect(clientAddress('6.6.6.6, 1.2.3.4, 10.0.0.7, 100.64.1.2', '10.0.0.5')).toBe('1.2.3.4')
    expect(clientAddress('1.2.3.4, ::ffff:192.168.1.1', '10.0.0.5')).toBe('1.2.3.4')
    expect(clientAddress('2001:db8::1, fd00::1', '10.0.0.5')).toBe('2001:db8::1')
    expect(clientAddress('10.1.1.1, 1.2.3.4', '10.0.0.5'), 'writing an internal address changes nothing').toBe('1.2.3.4')
    expect(clientAddress('10.0.0.7, 10.0.0.8', '10.0.0.5'), 'nothing but internal hops').toBe('10.0.0.8')
  })

  it('a client can\'t be anyone else by writing more hops, however many proxies the deploy skips', () => {
    expect(clientAddress('9.9.9.9, 8.8.8.8, 1.2.3.4', '10.0.0.5')).toBe('1.2.3.4')
    expect(clientAddress('9.9.9.9, 8.8.8.8, 1.2.3.4, 47.1.1.1', '10.0.0.5', 1)).toBe('1.2.3.4')
  })

  it('proxies with public addresses, such as a firewall in front of the Studio, are skipped when the deploy names them', () => {
    expect(clientAddress('6.6.6.6, 1.2.3.4, 47.1.1.1, 10.0.0.7', '10.0.0.5', 1)).toBe('1.2.3.4')
    expect(clientAddress('47.1.1.1', '10.0.0.5', 1), 'fewer hops than proxies').toBe('47.1.1.1')
  })

  it('one client can\'t hold every slot, and its neighbours don\'t feel it', () => {
    const slots = new ClientSlots(2)
    expect(slots.take('1.2.3.4')).toBeTypeOf('function')
    expect(slots.take('1.2.3.4')).toBeTypeOf('function')
    expect(slots.take('1.2.3.4')).toBeUndefined()
    expect(slots.take('5.6.7.8')).toBeTypeOf('function')
  })

  it('a slot frees once however many paths end the session, and only for its own client', () => {
    const slots = new ClientSlots(2)
    const first = slots.take('1.2.3.4')!
    slots.take('1.2.3.4')
    const neighbour = slots.take('5.6.7.8')!
    first()
    first()
    neighbour()
    expect(slots.take('1.2.3.4'), 'the slot it gave back').toBeTypeOf('function')
    expect(slots.take('1.2.3.4'), 'releasing twice must not free a second one').toBeUndefined()
  })

  it('a session opens from the demo\'s own page, not from another site\'s page through its visitors\' browsers', () => {
    expect(allowsNewSession('same-origin')).toBe(true)
    for (const site of ['cross-site', 'same-site', 'none'])
      expect(allowsNewSession(site), site).toBe(false)
  })

  it('a client that doesn\'t say where a request comes from isn\'t turned away: scripts can forge it, and old browsers lack it', () => {
    expect(allowsNewSession(undefined)).toBe(true)
  })

  it('a relayed request can\'t ask for many answers or an unbounded one', () => {
    expect(capRelayBody({ model: 'm', n: 50, best_of: 9, max_tokens: 1_000_000, max_completion_tokens: 900_000, messages: [] }))
      .toEqual({ model: 'm', n: 1, max_tokens: 16384, max_completion_tokens: 16384, messages: [] })
    expect(capRelayBody({ model: 'm', max_tokens: 2000, messages: [] })).toEqual({ model: 'm', max_tokens: 2000, messages: [] })
  })

  it('static files stay inside the public folder and hidden files stay hidden, encoded or not', () => {
    const root = resolve('/app/dist/web')
    expect(staticFile(root, '/')).toBe(join(root, 'index.html'))
    expect(staticFile(root, '/assets/index.js')).toBe(join(root, 'assets/index.js'))
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/.env', '/%2eenv', '/assets/%2e%2e/%2e%2e/etc/passwd', '/a%00b'])
      expect(staticFile(root, path), path).toBeUndefined()
  })

  it('a session nobody has open gives its slot back sooner than one still on screen', () => {
    expect(idleLimit(0)).toBe(30 * 60 * 1000)
    expect(idleLimit(1)).toBe(2 * 60 * 60 * 1000)
    expect(idleLimit(3)).toBe(2 * 60 * 60 * 1000)
  })

  describe('the shared model quota', () => {
    const noon = Date.UTC(2026, 10, 2, 4)
    const midnight = Date.UTC(2026, 10, 2, 16)

    it('all visitors together stay under a rate the free quota can bear', () => {
      const budget = new RelayBudget({ perMinute: 2, perClientPerDay: 100, perDay: 100 })
      expect(budget.take('a', noon)).toBeUndefined()
      expect(budget.take('b', noon)).toBeUndefined()
      expect(budget.take('c', noon)).toBe('minute')
      expect(budget.take('c', noon + 60_000)).toBeUndefined()
    })

    it('one client can\'t spend the whole day, and its neighbours don\'t feel it', () => {
      const budget = new RelayBudget({ perMinute: 100, perClientPerDay: 2, perDay: 100 })
      expect(budget.take('a', noon)).toBeUndefined()
      expect(budget.take('a', noon)).toBeUndefined()
      expect(budget.take('a', noon)).toBe('client-day')
      expect(budget.take('b', noon)).toBeUndefined()
    })

    it('the day has a ceiling for everyone together', () => {
      const budget = new RelayBudget({ perMinute: 100, perClientPerDay: 100, perDay: 2 })
      expect(budget.take('a', noon)).toBeUndefined()
      expect(budget.take('b', noon)).toBeUndefined()
      expect(budget.take('c', noon)).toBe('day')
    })

    it('a refused call costs nothing', () => {
      const budget = new RelayBudget({ perMinute: 1, perClientPerDay: 2, perDay: 100 })
      expect(budget.take('a', noon)).toBeUndefined()
      for (let i = 0; i < 5; i++)
        expect(budget.take('a', noon)).toBe('minute')
      expect(budget.take('a', noon + 60_000), 'the refused calls didn\'t use up its day').toBeUndefined()
      expect(budget.take('a', noon + 120_000)).toBe('client-day')
    })

    it('a new day starts at midnight in Beijing', () => {
      const budget = new RelayBudget({ perMinute: 100, perClientPerDay: 1, perDay: 100 })
      expect(budget.take('a', midnight - 1)).toBeUndefined()
      expect(budget.take('a', midnight - 1)).toBe('client-day')
      expect(budget.take('a', midnight)).toBeUndefined()
    })

    it('says when a client has nothing left today, so the page can tell before anyone types', () => {
      const budget = new RelayBudget({ perMinute: 100, perClientPerDay: 1, perDay: 2 })
      expect(budget.out('a', noon)).toBe(false)
      budget.take('a', noon)
      expect(budget.out('a', noon)).toBe(true)
      expect(budget.out('b', noon)).toBe(false)
      budget.take('b', noon)
      expect(budget.out('c', noon), 'the day\'s ceiling is everyone\'s').toBe(true)
      expect(budget.out('a', midnight)).toBe(false)
    })
  })

  it('a uid isn\'t handed to the next visitor while one may still have processes or files left behind', () => {
    const pool = new UidPool(20001, 20004)
    const first = pool.take()
    pool.release(first!)
    const seen = [pool.take(), pool.take(), pool.take()]
    expect(seen).not.toContain(first)
    expect(new Set(seen).size).toBe(3)
  })
})
