import { DurableObject } from 'cloudflare:workers'

export class ProxyRateLimiter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS limit_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        request_count INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      );`)
    })
  }

  async allow(limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now()
    const row = this.ctx.storage.sql.exec<{ request_count: number; reset_at: number }>('SELECT request_count, reset_at FROM limit_state WHERE singleton = 1').toArray()[0]
    if (!row || row.reset_at <= now) {
      const resetAt = now + windowMs
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO limit_state (singleton, request_count, reset_at) VALUES (1, 1, ?)', resetAt)
      await this.ctx.storage.setAlarm(resetAt)
      return true
    }
    if (row.request_count >= limit) return false
    this.ctx.storage.sql.exec('UPDATE limit_state SET request_count = request_count + 1 WHERE singleton = 1')
    return true
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll()
  }
}
