import { describe, expect, it } from 'vitest'
import { isRouteSample } from './monitor'

describe('route response validation', () => {
  const sample = { ok: true, ip: '203.0.113.10', family: 'IPv4', observedAt: '2026-09-08T00:00:00Z' }
  it('accepts complete observations and explicit unavailable observations', () => {
    expect(isRouteSample(sample)).toBe(true)
    expect(isRouteSample({ ...sample, ok: false, ip: '', family: 'Unknown' })).toBe(true)
  })
  it('rejects malformed responses before rendering a success or invalid timestamp', () => {
    for (const value of [null, {}, [], { ...sample, ip: '' }, { ...sample, ok: 'true' }, { ...sample, observedAt: 'invalid' }, { ...sample, organization: {} }]) {
      expect(isRouteSample(value)).toBe(false)
    }
  })
})
