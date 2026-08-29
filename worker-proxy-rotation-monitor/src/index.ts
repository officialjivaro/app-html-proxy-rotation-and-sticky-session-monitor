import { ProxyRateLimiter } from './durableObject'
import { ensurePublicDestination, probeProxy } from './proxyProbe'
import { normalizeProxyInput } from './proxyValidation'
import { resolveProxyMonitorRequestRoute } from './routing'
import { hmac, ipFamily, securityHeaders } from './security'

export { ProxyRateLimiter }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const route = resolveProxyMonitorRequestRoute(url.pathname)
    try {
      if (request.method === 'GET' && route.pathname === '/api/route') return await configuredRoute(request, env, url)
      if (request.method === 'POST' && route.pathname === '/api/proxy-probe') return await explicitProxy(request, env, url)
      if (route.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404)
      return addHeaders(await env.ASSETS.fetch(request))
    } catch (error) {
      console.error(JSON.stringify({ message: 'proxy_monitor_request_failed', path: url.pathname, error: error instanceof Error ? error.name : 'unknown' }))
      return json({ error: error instanceof Error ? error.message : 'The route sample failed.' }, 400)
    }
  },
} satisfies ExportedHandler<Env>

async function configuredRoute(request: Request, env: Env, url: URL): Promise<Response> {
  if (!browserRequestAllowed(request, url)) return json({ error: 'Cross-site route observations are not allowed.' }, 403)
  const sourceIp = request.headers.get('CF-Connecting-IP') || localIp(url)
  if (!sourceIp) return json({ error: 'The configured route could not be observed.' }, 503)
  if (!await rateAllowed(request, env, url, 'configured', 90)) return json({ error: 'This monitor reached its configured-route request limit.' }, 429)
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf || {}
  return json({
    ok: true,
    ip: sourceIp,
    family: ipFamily(sourceIp),
    asn: typeof cf.asn === 'number' ? `AS${cf.asn}` : undefined,
    organization: typeof cf.asOrganization === 'string' ? cf.asOrganization : undefined,
    country: typeof cf.country === 'string' ? cf.country : undefined,
    colo: typeof cf.colo === 'string' ? cf.colo : undefined,
    observedAt: new Date().toISOString(),
  })
}

async function explicitProxy(request: Request, env: Env, url: URL): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: 'Cross-site proxy tests are not allowed.' }, 403)
  const text = await request.text()
  if (new TextEncoder().encode(text).length > 4096) return json({ error: 'The proxy request is too large.' }, 413)
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return json({ error: 'The proxy request body is invalid.' }, 400) }
  const input = normalizeProxyInput(raw)
  if (!await rateAllowed(request, env, url, 'explicit-source', 20)) return json({ error: 'This browser reached the explicit-proxy test limit.' }, 429)
  if (!await rateAllowed(request, env, url, `explicit-endpoint:${input.protocol}:${input.host}:${input.port}`, 16)) return json({ error: 'This proxy endpoint reached the test limit.' }, 429)

  await ensurePublicDestination(input.host)
  const ip = await probeProxy(input)
  return json({
    ok: true,
    ip,
    family: ipFamily(ip),
    organization: 'Not provided by the fixed probe',
    observedAt: new Date().toISOString(),
  })
}

async function rateAllowed(request: Request, env: Env, url: URL, scope: string, limit: number): Promise<boolean> {
  const sourceIp = request.headers.get('CF-Connecting-IP') || localIp(url)
  const secret = env.RATE_LIMIT_SECRET || (isLocal(url) ? 'aerod-local-development-only' : '')
  if (!sourceIp || !secret) return false
  const key = await hmac(`${scope}:${sourceIp}`, secret)
  return env.RATE_LIMITS.getByName(key).allow(limit, 10 * 60 * 1000)
}

function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin')
  return !origin ? isLocal(url) : origin === url.origin
}

function browserRequestAllowed(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin')
  if (origin && origin !== url.origin) return false
  const fetchSite = request.headers.get('Sec-Fetch-Site')
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none'
}

function localIp(url: URL): string { return isLocal(url) ? '198.51.100.10' : '' }
function isLocal(url: URL): boolean { return ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname) }

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: securityHeaders() })
}

function addHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(securityHeaders())) headers.set(name, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
