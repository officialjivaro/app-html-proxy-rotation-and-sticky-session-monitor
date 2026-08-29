export const PROXY_MONITOR_APP_MOUNT = '/apps/proxy-rotation-sticky-session-monitor'

export function proxyMonitorAppPath(currentPathname: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const mounted = currentPathname === PROXY_MONITOR_APP_MOUNT || currentPathname.startsWith(`${PROXY_MONITOR_APP_MOUNT}/`)
  return `${mounted ? PROXY_MONITOR_APP_MOUNT : ''}${normalizedPath}`
}
