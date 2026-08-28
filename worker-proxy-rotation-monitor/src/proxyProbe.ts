import { connect } from 'cloudflare:sockets'
import { isPublicIp, type ProxyInput } from './proxyValidation'

const TARGET_HOST = 'api.ipify.org'
const TARGET_PORT = 80
const MAX_RESPONSE_BYTES = 16 * 1024
const encoder = new TextEncoder()
type Socket = ReturnType<typeof connect>

export async function ensurePublicDestination(host: string): Promise<void> {
  if (host.includes(':') || /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(host)) {
    if (!isPublicIp(host)) throw new Error('Private, reserved, and local proxy addresses are not allowed.')
    return
  }

  const addresses = new Set<string>()
  for (const type of ['A', 'AAAA']) {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { Accept: 'application/dns-json' },
    })
    if (!response.ok) throw new Error('The proxy hostname could not be validated safely.')
    const body = await response.json() as { Status?: number; Answer?: Array<{ data?: string }> }
    if (body.Status !== 0 && body.Status !== 3) throw new Error('The proxy hostname could not be validated safely.')
    for (const answer of body.Answer || []) if (answer.data) addresses.add(answer.data)
  }
  if (!addresses.size) throw new Error('The proxy hostname did not resolve to a public address.')
  if ([...addresses].some((address) => !isPublicIp(address))) throw new Error('The proxy hostname resolves to a private or reserved address.')
}

export async function probeProxy(input: ProxyInput): Promise<string> {
  const socket = connect(
    { hostname: input.host, port: input.port },
    { secureTransport: input.protocol === 'https' ? 'on' : 'off', allowHalfOpen: false },
  )
  const reader = new SocketReader(socket)

  try {
    await withTimeout(socket.opened, 5000, 'The proxy connection timed out.')
    if (input.protocol === 'socks5') {
      await negotiateSocks5(socket, reader, input)
      await write(socket, encoder.encode(buildOriginRequest()))
    } else {
      await write(socket, encoder.encode(buildForwardProxyRequest(input)))
    }
    const responseBytes = await reader.readToEnd(MAX_RESPONSE_BYTES, 8000)
    return parseIpResponse(new TextDecoder().decode(responseBytes))
  } finally {
    try { await socket.close() } catch { /* The runtime may have already closed it. */ }
  }
}

async function negotiateSocks5(socket: Socket, reader: SocketReader, input: ProxyInput): Promise<void> {
  const hasCredentials = Boolean(input.username)
  await write(socket, new Uint8Array(hasCredentials ? [5, 2, 0, 2] : [5, 1, 0]))
  const greeting = await reader.readExact(2, 4000)
  if (greeting[0] !== 5 || greeting[1] === 0xff) throw new Error('The SOCKS5 proxy rejected the available authentication methods.')

  if (greeting[1] === 2) {
    if (!hasCredentials) throw new Error('The SOCKS5 proxy requires credentials.')
    const username = encoder.encode(input.username)
    const password = encoder.encode(input.password)
    if (username.length > 255 || password.length > 255) throw new Error('SOCKS5 credentials are too long.')
    await write(socket, concat(new Uint8Array([1, username.length]), username, new Uint8Array([password.length]), password))
    const auth = await reader.readExact(2, 4000)
    if (auth[1] !== 0) throw new Error('Proxy authentication was rejected.')
  } else if (greeting[1] !== 0) {
    throw new Error('The SOCKS5 proxy selected an unsupported authentication method.')
  }

  const target = encoder.encode(TARGET_HOST)
  await write(socket, concat(new Uint8Array([5, 1, 0, 3, target.length]), target, new Uint8Array([TARGET_PORT >> 8, TARGET_PORT & 0xff])))
  const reply = await reader.readExact(4, 5000)
  if (reply[0] !== 5 || reply[1] !== 0) throw new Error('The SOCKS5 proxy could not reach the fixed probe endpoint.')
  if (reply[3] === 1) await reader.readExact(4 + 2, 3000)
  else if (reply[3] === 4) await reader.readExact(16 + 2, 3000)
  else if (reply[3] === 3) {
    const length = (await reader.readExact(1, 3000))[0]
    await reader.readExact(length + 2, 3000)
  } else throw new Error('The SOCKS5 proxy returned an invalid address response.')
}

function buildForwardProxyRequest(input: ProxyInput): string {
  const authorization = input.username ? `Proxy-Authorization: Basic ${base64(`${input.username}:${input.password}`)}\r\n` : ''
  return `GET http://${TARGET_HOST}/?format=json HTTP/1.1\r\nHost: ${TARGET_HOST}\r\n${authorization}Accept: application/json\r\nConnection: close\r\n\r\n`
}

function buildOriginRequest(): string {
  return `GET /?format=json HTTP/1.1\r\nHost: ${TARGET_HOST}\r\nAccept: application/json\r\nConnection: close\r\n\r\n`
}

function parseIpResponse(value: string): string {
  const divider = value.indexOf('\r\n\r\n')
  if (divider < 0) throw new Error('The proxy returned an invalid HTTP response.')
  const head = value.slice(0, divider)
  const status = Number(head.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/u)?.[1])
  if (status === 407) throw new Error('Proxy authentication was rejected.')
  if (status !== 200) throw new Error('The proxy could not reach the fixed probe endpoint.')
  let body = value.slice(divider + 4).trim()
  if (/transfer-encoding:\s*chunked/iu.test(head)) body = decodeChunked(body).trim()

  let ip = ''
  try {
    const parsed = JSON.parse(body) as { ip?: unknown }
    if (typeof parsed.ip === 'string') ip = parsed.ip.trim()
  } catch {
    ip = body.split(/\s/u)[0] || ''
  }
  if (!isPublicIp(ip)) throw new Error('The fixed probe returned an invalid public address.')
  return ip
}

function decodeChunked(value: string): string {
  let offset = 0
  let output = ''
  while (offset < value.length) {
    const lineEnd = value.indexOf('\r\n', offset)
    if (lineEnd < 0) break
    const size = Number.parseInt(value.slice(offset, lineEnd).split(';')[0], 16)
    if (!Number.isFinite(size) || size < 0) throw new Error('The probe returned invalid chunked data.')
    if (size === 0) return output
    const start = lineEnd + 2
    output += value.slice(start, start + size)
    offset = start + size + 2
  }
  throw new Error('The probe returned incomplete chunked data.')
}

async function write(socket: Socket, value: Uint8Array): Promise<void> {
  const writer = socket.writable.getWriter()
  try { await withTimeout(writer.write(value), 4000, 'The proxy write timed out.') }
  finally { writer.releaseLock() }
}

class SocketReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>
  private stash = new Uint8Array()

  constructor(socket: Socket) {
    this.reader = socket.readable.getReader()
  }

  async readExact(length: number, timeoutMs: number): Promise<Uint8Array> {
    while (this.stash.length < length) {
      const next = await withTimeout(this.reader.read(), timeoutMs, 'The proxy response timed out.')
      if (next.done || !next.value) throw new Error('The proxy closed the connection early.')
      this.stash = concat(this.stash, next.value)
      if (this.stash.length > MAX_RESPONSE_BYTES) throw new Error('The proxy response exceeded the safety limit.')
    }
    const result = this.stash.slice(0, length)
    this.stash = this.stash.slice(length)
    return result
  }

  async readToEnd(maxBytes: number, timeoutMs: number): Promise<Uint8Array> {
    const chunks: Uint8Array[] = this.stash.length ? [this.stash] : []
    let total = this.stash.length
    this.stash = new Uint8Array()
    while (true) {
      const next = await withTimeout(this.reader.read(), timeoutMs, 'The proxy response timed out.')
      if (next.done) return concat(...chunks)
      if (!next.value) continue
      total += next.value.length
      if (total > maxBytes) throw new Error('The proxy response exceeded the safety limit.')
      chunks.push(next.value)
    }
  }
}

function concat(...values: Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(values.reduce((total, value) => total + value.length, 0))
  let offset = 0
  for (const value of values) { result.set(value, offset); offset += value.length }
  return result
}

function base64(value: string): string {
  const bytes = encoder.encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer = 0
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs) as unknown as number })
  try { return await Promise.race([promise, timeout]) }
  finally { clearTimeout(timer) }
}
