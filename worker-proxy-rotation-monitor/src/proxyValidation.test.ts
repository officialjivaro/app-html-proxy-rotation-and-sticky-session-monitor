import { describe, expect, it } from 'vitest'
import { isPublicIp, normalizeProxyInput } from './proxyValidation'

describe('proxy endpoint validation', () => {
  it('accepts a public hostname and common proxy port', () => {
    expect(normalizeProxyInput({ protocol: 'http', host: 'proxy.example.com', port: 8080, username: '', password: '' }).host).toBe('proxy.example.com')
  })

  it.each(['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1'])('rejects non-public address %s', (host) => {
    expect(() => normalizeProxyInput({ protocol: 'socks5', host, port: 1080, username: '', password: '' })).toThrow()
  })

  it('rejects credentials embedded in the host field', () => {
    expect(() => normalizeProxyInput({ protocol: 'http', host: 'user@example.com', port: 8080, username: '', password: '' })).toThrow()
  })

  it('classifies public IPs', () => {
    expect(isPublicIp('8.8.8.8')).toBe(true)
    expect(isPublicIp('2606:4700:4700::1111')).toBe(true)
  })
})
