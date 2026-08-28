export type ProxyProtocol = 'http' | 'https' | 'socks5'

export type ProxyInput = {
  protocol: ProxyProtocol
  host: string
  port: number
  username: string
  password: string
}

export function normalizeProxyInput(value: unknown): ProxyInput {
  if (!value || typeof value !== 'object') throw new Error('Enter a valid proxy endpoint.')
  const input = value as Record<string, unknown>
  const protocol = input.protocol
  const host = typeof input.host === 'string' ? input.host.trim().toLowerCase() : ''
  const port = Number(input.port)
  const username = typeof input.username === 'string' ? input.username : ''
  const password = typeof input.password === 'string' ? input.password : ''

  if (!['http', 'https', 'socks5'].includes(String(protocol))) throw new Error('Choose HTTP, HTTPS, or SOCKS5.')
  if (!host || host.length > 253 || /[\/@?#\s]/u.test(host)) throw new Error('Enter a hostname or IP without a URL path or credentials.')
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || port === 25) throw new Error('Enter an allowed proxy port from 1 to 65535.')
  if (username.length > 255 || password.length > 255) throw new Error('Proxy credentials must each be 255 characters or fewer.')
  if ((username && !password) || (!username && password)) throw new Error('Provide both username and password, or leave both blank.')

  const cleanHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (isBlockedHostname(cleanHost)) throw new Error('Local, private, and metadata hostnames are not allowed.')
  if (looksLikeIpv4(cleanHost) && !isPublicIpv4(cleanHost)) throw new Error('Private, reserved, and local proxy addresses are not allowed.')
  if (cleanHost.includes(':') && !isPublicIpv6(cleanHost)) throw new Error('Private, reserved, and local IPv6 proxy addresses are not allowed.')
  if (!looksLikeIpv4(cleanHost) && !cleanHost.includes(':') && !isValidHostname(cleanHost)) throw new Error('Enter a valid public proxy hostname or IP address.')

  return { protocol: protocol as ProxyProtocol, host: cleanHost, port, username, password }
}

export function isPublicIp(value: string): boolean {
  return value.includes(':') ? isPublicIpv6(value) : isPublicIpv4(value)
}

export function isPublicIpv4(value: string): boolean {
  const parts = value.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part) || Number(part) > 255 || (part.length > 1 && part.startsWith('0')))) return false
  const [a, b, c] = parts.map(Number)
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0 && c === 0) return false
  if (a === 192 && b === 0 && c === 2) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

export function isPublicIpv6(value: string): boolean {
  const normalized = value.toLowerCase()
  try {
    if (new URL(`http://[${normalized}]/`).hostname.length < 3) return false
  } catch {
    return false
  }
  return !(
    normalized === '::' || normalized === '::1' || normalized.startsWith('::ffff:') ||
    normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith('ff') || normalized.startsWith('2001:db8')
  )
}

function looksLikeIpv4(value: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(value)
}

function isBlockedHostname(value: string): boolean {
  return value === 'localhost' || value === 'localhost.localdomain' || value === 'metadata.google.internal' ||
    value.endsWith('.localhost') || value.endsWith('.local') || value.endsWith('.internal') || value.endsWith('.home') || value.endsWith('.lan')
}

function isValidHostname(value: string): boolean {
  if (value.length > 253 || !value.includes('.')) return false
  return value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
}
