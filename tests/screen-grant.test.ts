import { describe, expect, it } from 'vitest'
import { ScreenGrant } from '../packages/senses/screen-grant'

describe('native screen selection', () => {
  it('requires an explicit listed selection and allows one matching capture only', () => {
    const grant = new ScreenGrant()
    expect(grant.consume(true)).toBeUndefined()
    grant.offer([{ id: 'window:1' }, { id: 'screen:2' }])
    expect(grant.select('unlisted')).toBe(false)
    expect(grant.select('window:1')).toBe(true)
    expect(grant.consume(true)).toEqual({ id: 'window:1' })
    expect(grant.consume(true)).toBeUndefined()
  })
  it('denies replay, invalid frame requests, expired lists and expired selections', () => {
    let time = 0
    const grant = new ScreenGrant(() => time)
    grant.offer([{ id: '1' }])
    grant.select('1')
    expect(grant.consume(false)).toBeUndefined()
    expect(grant.ready).toBe(false)
    grant.offer([{ id: '1' }])
    time += 60001
    expect(grant.select('1')).toBe(false)
    grant.offer([{ id: '2' }])
    grant.select('2')
    time += 15001
    expect(grant.consume(true)).toBeUndefined()
  })
  it('relisting or clearing invalidates any previous choice', () => {
    const grant = new ScreenGrant()
    grant.offer([{ id: '1' }])
    grant.select('1')
    grant.offer([{ id: '2' }])
    expect(grant.ready).toBe(false)
    expect(grant.select('1')).toBe(false)
    grant.select('2')
    grant.clear()
    expect(grant.consume(true)).toBeUndefined()
  })
})
