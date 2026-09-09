export type RouteSample = {
  ok: boolean
  ip: string
  family: 'IPv4' | 'IPv6' | 'Unknown'
  asn?: string
  organization?: string
  country?: string
  colo?: string
  observedAt: string
  error?: string
}

export type MonitorSummary = {
  tone: 'waiting' | 'stable' | 'rotating' | 'inconclusive'
  title: string
  explanation: string
  successful: number
  failures: number
  uniqueRoutes: number
  changes: number
  longestStableMs: number
  averageRotationMs: number | null
}

export function isRouteSample(value: unknown): value is RouteSample {
  if (!value || typeof value !== 'object') return false
  const sample = value as Record<string, unknown>
  return typeof sample.ok === 'boolean' && typeof sample.ip === 'string'
    && (!sample.ok || sample.ip.length > 0)
    && ['IPv4', 'IPv6', 'Unknown'].includes(String(sample.family))
    && typeof sample.observedAt === 'string' && Number.isFinite(Date.parse(sample.observedAt))
    && ['asn', 'organization', 'country', 'colo', 'error'].every(key => sample[key] === undefined || typeof sample[key] === 'string')
}

export function summarizeSamples(samples: RouteSample[]): MonitorSummary {
  const successful = samples.filter((sample) => sample.ok && sample.ip)
  const failures = samples.length - successful.length
  const uniqueRoutes = new Set(successful.map((sample) => sample.ip)).size
  let changes = 0
  const changeTimes: number[] = []
  let segmentStart = successful[0] ? Date.parse(successful[0].observedAt) : 0
  let longestStableMs = 0

  for (let index = 1; index < successful.length; index += 1) {
    const previous = successful[index - 1]
    const current = successful[index]
    if (current.ip !== previous.ip) {
      const currentTime = Date.parse(current.observedAt)
      changes += 1
      changeTimes.push(currentTime)
      longestStableMs = Math.max(longestStableMs, Math.max(0, currentTime - segmentStart))
      segmentStart = currentTime
    }
  }

  if (successful.length > 1) {
    longestStableMs = Math.max(longestStableMs, Math.max(0, Date.parse(successful.at(-1)!.observedAt) - segmentStart))
  }

  const rotationIntervals = changeTimes.slice(1).map((time, index) => time - changeTimes[index])
  const averageRotationMs = rotationIntervals.length
    ? Math.round(rotationIntervals.reduce((total, value) => total + value, 0) / rotationIntervals.length)
    : null

  if (!samples.length) {
    return {
      tone: 'waiting', title: 'Ready to observe this route', explanation: 'Start a bounded monitor to see whether the observed public address stays stable or changes.',
      successful: 0, failures: 0, uniqueRoutes: 0, changes: 0, longestStableMs: 0, averageRotationMs: null,
    }
  }
  if (successful.length < 2) {
    return {
      tone: 'inconclusive', title: 'Not enough successful samples yet', explanation: failures ? 'The route could not be observed consistently.' : 'Keep the monitor running for at least two observations.',
      successful: successful.length, failures, uniqueRoutes, changes, longestStableMs, averageRotationMs,
    }
  }
  if (changes > 0) {
    return {
      tone: 'rotating', title: `${changes} route change${changes === 1 ? '' : 's'} observed`, explanation: `${uniqueRoutes} public addresses appeared during this bounded observation.`,
      successful: successful.length, failures, uniqueRoutes, changes, longestStableMs, averageRotationMs,
    }
  }
  const failureHeavy = failures * 3 >= samples.length
  return {
    tone: failureHeavy ? 'inconclusive' : 'stable',
    title: failureHeavy ? 'Route observations were inconsistent' : 'Stable during this observation',
    explanation: failureHeavy
      ? 'Too many samples failed to support a useful sticky-session conclusion.'
      : `All ${successful.length} successful samples used ${successful[0].ip}.`,
    successful: successful.length, failures, uniqueRoutes, changes, longestStableMs, averageRotationMs,
  }
}

export function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return 'Not enough rotations'
  if (milliseconds < 1000) return '< 1 second'
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}m ${remainder}s`
}
