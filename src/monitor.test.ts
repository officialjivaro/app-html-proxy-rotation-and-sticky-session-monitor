import { describe, expect, it } from 'vitest'
import { summarizeSamples, type RouteSample } from './monitor'

function sample(ip: string, seconds: number, ok = true): RouteSample {
  return { ok, ip, family: 'IPv4', observedAt: new Date(Date.UTC(2026, 7, 28, 0, 0, seconds)).toISOString() }
}

describe('summarizeSamples', () => {
  it('reports a stable observed route', () => {
    expect(summarizeSamples([sample('198.51.100.1', 0), sample('198.51.100.1', 5)]).tone).toBe('stable')
  })

  it('counts route changes and unique addresses', () => {
    const summary = summarizeSamples([sample('198.51.100.1', 0), sample('203.0.113.2', 5), sample('198.51.100.1', 10)])
    expect(summary.tone).toBe('rotating')
    expect(summary.changes).toBe(2)
    expect(summary.uniqueRoutes).toBe(2)
  })

  it('is inconclusive with too many failures', () => {
    const summary = summarizeSamples([sample('', 0, false), sample('', 5, false), sample('198.51.100.1', 10), sample('198.51.100.1', 15)])
    expect(summary.tone).toBe('inconclusive')
  })
})
