# Aerod Proxy Rotation & Sticky Session Monitor

A standalone Vue application and Cloudflare Worker for observing whether an already-configured browser/system proxy route remains stable or rotates during a bounded session.

An advanced explicit-proxy mode can test HTTP, HTTPS, or SOCKS5 proxy credentials against one fixed public IP echo endpoint. Credentials are held only in page memory, sent in a same-origin POST body, and are never stored or logged by the application.

## Local development

```powershell
npm.cmd install
npm.cmd test
npm.cmd run build
npx.cmd wrangler dev
```

Set `RATE_LIMIT_SECRET` with `wrangler secret put RATE_LIMIT_SECRET` before production deployment.
