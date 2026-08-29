import { describe, expect, it } from 'vitest'
import { resolveProxyMonitorRequestRoute } from './routing'

describe('proxy monitor Worker routing', () => {
  it('normalizes canonical Aerod API routes', () => {
    expect(resolveProxyMonitorRequestRoute('/apps/proxy-rotation-sticky-session-monitor/api/route')).toEqual({
      mountPath: '/apps/proxy-rotation-sticky-session-monitor',
      pathname: '/api/route',
    })
  })

  it('keeps standalone routes unchanged', () => {
    expect(resolveProxyMonitorRequestRoute('/api/proxy-probe')).toEqual({
      mountPath: '',
      pathname: '/api/proxy-probe',
    })
  })
})
