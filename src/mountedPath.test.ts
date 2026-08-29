import { describe, expect, it } from 'vitest'
import { proxyMonitorAppPath } from './mountedPath'

describe('proxy monitor mounted paths', () => {
  it('uses Aerod-mounted API paths on the canonical app route', () => {
    expect(proxyMonitorAppPath('/apps/proxy-rotation-sticky-session-monitor/', '/api/route'))
      .toBe('/apps/proxy-rotation-sticky-session-monitor/api/route')
  })

  it('keeps root API paths for standalone and local development', () => {
    expect(proxyMonitorAppPath('/', '/api/route')).toBe('/api/route')
  })
})
