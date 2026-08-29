export const PROXY_MONITOR_APP_MOUNT = '/apps/proxy-rotation-sticky-session-monitor'

export type ProxyMonitorRequestRoute = {
  mountPath: '' | typeof PROXY_MONITOR_APP_MOUNT
  pathname: string
}

export function resolveProxyMonitorRequestRoute(pathname: string): ProxyMonitorRequestRoute {
  if (pathname === PROXY_MONITOR_APP_MOUNT || pathname.startsWith(`${PROXY_MONITOR_APP_MOUNT}/`)) {
    return {
      mountPath: PROXY_MONITOR_APP_MOUNT,
      pathname: pathname.slice(PROXY_MONITOR_APP_MOUNT.length) || '/',
    }
  }
  return { mountPath: '', pathname }
}
