export async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
  return [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function ipFamily(ip: string): 'IPv4' | 'IPv6' | 'Unknown' {
  if (ip.includes(':')) return 'IPv6'
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(ip)) return 'IPv4'
  return 'Unknown'
}

export function securityHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  }
}
