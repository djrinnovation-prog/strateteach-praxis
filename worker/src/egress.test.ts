import { resolveEgress, productionEgressOk, egressModeLabel } from './egress'

describe('egress config (B0) — explicit native vs proxy', () => {
  describe('resolveEgress', () => {
    test('proxy set → proxy present, native not allowed', () => {
      expect(resolveEgress({ EXCHANGE_HTTPS_PROXY: '  http://p:8080  ' })).toEqual({ proxy: 'http://p:8080', nativeAllowed: false })
    })
    test('EXCHANGE_EGRESS_MODE=native → nativeAllowed, no proxy', () => {
      expect(resolveEgress({ EXCHANGE_EGRESS_MODE: 'native' })).toEqual({ proxy: null, nativeAllowed: true })
    })
    test('unset → neither', () => {
      expect(resolveEgress({})).toEqual({ proxy: null, nativeAllowed: false })
    })
    test('any non-"native" mode is NOT native (explicit opt-in only)', () => {
      expect(resolveEgress({ EXCHANGE_EGRESS_MODE: 'NATIVE' }).nativeAllowed).toBe(false)
      expect(resolveEgress({ EXCHANGE_EGRESS_MODE: 'direct' }).nativeAllowed).toBe(false)
      expect(resolveEgress({ EXCHANGE_EGRESS_MODE: '' }).nativeAllowed).toBe(false)
    })
  })

  describe('productionEgressOk', () => {
    test('testnet is always OK (no proxy, no native)', () => {
      expect(productionEgressOk(false, { proxy: null, nativeAllowed: false })).toBe(true)
    })
    test('production + proxy → OK', () => {
      expect(productionEgressOk(true, { proxy: 'http://p', nativeAllowed: false })).toBe(true)
    })
    test('production + native → OK', () => {
      expect(productionEgressOk(true, { proxy: null, nativeAllowed: true })).toBe(true)
    })
    test('production + neither → FAIL-CLOSED', () => {
      expect(productionEgressOk(true, { proxy: null, nativeAllowed: false })).toBe(false)
    })
  })

  describe('egressModeLabel', () => {
    test('proxy / native / unset', () => {
      expect(egressModeLabel({ proxy: 'http://p', nativeAllowed: false })).toBe('proxy')
      expect(egressModeLabel({ proxy: null, nativeAllowed: true })).toBe('native')
      expect(egressModeLabel({ proxy: null, nativeAllowed: false })).toBe('unset')
    })
  })
})
