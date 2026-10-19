import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { capRelayBody, clientAddress, sessionDirectory, staticFile, UidPool } from '../apps/web/guards'

/** The online demo's front door, tried the way a hostile visitor would. */
describe('the online demo\'s guards', () => {
  it('a session\'s folder is random, not its token, which a neighbour could read from `ps`', () => {
    const dir = sessionDirectory('/tmp/anna-web-sessions')
    expect(dir.startsWith('/tmp/anna-web-sessions/')).toBe(true)
    expect(sessionDirectory('/tmp/anna-web-sessions')).not.toBe(dir)
  })

  it('the client is the address the Studio\'s proxy saw, not one the client wrote into X-Forwarded-For', () => {
    expect(clientAddress('6.6.6.6, 1.2.3.4', '10.0.0.5')).toBe('1.2.3.4')
    expect(clientAddress('1.2.3.4', '10.0.0.5')).toBe('1.2.3.4')
    expect(clientAddress(undefined, '10.0.0.5')).toBe('10.0.0.5')
  })

  it('a relayed request can\'t ask for many answers or an unbounded one', () => {
    expect(capRelayBody({ model: 'm', n: 50, best_of: 9, max_tokens: 1_000_000, max_completion_tokens: 900_000, messages: [] }))
      .toEqual({ model: 'm', n: 1, max_tokens: 16384, max_completion_tokens: 16384, messages: [] })
    expect(capRelayBody({ model: 'm', max_tokens: 2000, messages: [] })).toEqual({ model: 'm', max_tokens: 2000, messages: [] })
  })

  it('static files stay inside the public folder and hidden files stay hidden, encoded or not', () => {
    const root = '/app/dist/web'
    expect(staticFile(root, '/')).toBe(join(root, 'index.html'))
    expect(staticFile(root, '/assets/index.js')).toBe(join(root, 'assets/index.js'))
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/.env', '/%2eenv', '/assets/%2e%2e/%2e%2e/etc/passwd', '/a%00b'])
      expect(staticFile(root, path), path).toBeUndefined()
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
