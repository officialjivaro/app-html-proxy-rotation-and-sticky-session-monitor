<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import AppHeader from './components/AppHeader.vue'
import { formatDuration, isRouteSample, summarizeSamples, type RouteSample } from './monitor'
import { proxyMonitorAppPath } from './mountedPath'

type Mode = 'configured' | 'explicit'

const mode = ref<Mode>('configured')
const status = ref<'idle' | 'running' | 'done'>('idle')
const samples = ref<RouteSample[]>([])
const errorMessage = ref('')
const activityMessage = ref('')
const protocol = ref<'http' | 'https' | 'socks5'>('http')
const host = ref('')
const port = ref(8080)
const username = ref('')
const password = ref('')
const sampling = ref(false)
let monitorTimer = 0
let runVersion = 0
let activeRequest: AbortController | null = null

const requestPath = (path: string) => proxyMonitorAppPath(window.location.pathname, path)

const summary = computed(() => summarizeSamples(samples.value))
const currentSample = computed(() => [...samples.value].reverse().find((sample) => sample.ok))
const maximumSamples = computed(() => mode.value === 'configured' ? 60 : 12)
const intervalMs = computed(() => mode.value === 'configured' ? 5000 : 10_000)

function switchMode(next: Mode): void {
  if (next === mode.value) return
  stopMonitor()
  mode.value = next
  samples.value = []
  errorMessage.value = ''
  activityMessage.value = next === 'configured'
    ? 'Configured-route mode uses this browser’s current network settings.'
    : 'Explicit mode is advanced and sends the entered credentials transiently for each sample.'
}

async function startMonitor(): Promise<void> {
  if (mode.value === 'explicit' && !validateExplicitForm()) return
  cancelSampling()
  samples.value = []
  errorMessage.value = ''
  status.value = 'running'
  activityMessage.value = 'Starting the first route observation…'
  await takeSample()
}

async function takeSample(): Promise<void> {
  if (sampling.value || status.value !== 'running') return
  const version = runVersion
  sampling.value = true
  try {
    const sample = mode.value === 'configured' ? await fetchConfiguredRoute() : await fetchExplicitRoute()
    if (version !== runVersion || status.value !== 'running') return
    samples.value.push(sample)
    activityMessage.value = sample.ok
      ? `Sample ${samples.value.length} observed ${sample.ip}.`
      : `Sample ${samples.value.length} could not observe a route.`
  } catch {
    if (version !== runVersion || status.value !== 'running') return
    samples.value.push({
      ok: false,
      ip: '',
      family: 'Unknown',
      observedAt: new Date().toISOString(),
      error: 'Route sample unavailable. Check your connection or proxy settings, then stop and restart the monitor.',
    })
    activityMessage.value = `Sample ${samples.value.length} failed. Check your connection or proxy settings; no route was inferred from this failure.`
  } finally {
    if (version === runVersion) sampling.value = false
  }

  if (version !== runVersion) return
  if (samples.value.length >= maximumSamples.value) {
    status.value = 'done'
    activityMessage.value = 'The bounded monitor completed.'
    return
  }
  if (status.value === 'running') monitorTimer = window.setTimeout(() => void takeSample(), intervalMs.value)
}

async function fetchConfiguredRoute(): Promise<RouteSample> {
  return requestSample('/api/route', { headers: { Accept: 'application/json' }, cache: 'no-store' })
}

async function fetchExplicitRoute(): Promise<RouteSample> {
  return requestSample('/api/proxy-probe', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      protocol: protocol.value,
      host: host.value.trim(),
      port: Number(port.value),
      username: username.value,
      password: password.value,
    }),
  })
}

async function requestSample(path: string, init: RequestInit): Promise<RouteSample> {
  const controller = new AbortController()
  activeRequest = controller
  const timer = window.setTimeout(() => controller.abort(), 15_000)
  let responseStatus = 0
  try {
    const response = await fetch(requestPath(path), { ...init, signal: controller.signal })
    responseStatus = response.status
    if (!response.ok) throw new Error('Route request failed')
    const data: unknown = await response.json()
    if (!isRouteSample(data)) throw new Error('Invalid route response')
    return data.ok ? data : { ...data, error: 'No route was observed. Check your connection or proxy settings and retry.' }
  } catch (error) {
    // Do not log endpoints, credentials, IP observations, or response bodies.
    if (activeRequest === controller) console.warn('Aerod route sample unavailable.', { status: responseStatus })
    throw error
  } finally {
    window.clearTimeout(timer)
    if (activeRequest === controller) activeRequest = null
  }
}

function cancelSampling(): void {
  stopTimer()
  runVersion++
  const pending = activeRequest
  activeRequest = null
  pending?.abort()
  sampling.value = false
}

function validateExplicitForm(): boolean {
  errorMessage.value = ''
  const cleanHost = host.value.trim()
  if (!cleanHost || cleanHost.length > 253) {
    errorMessage.value = 'Enter a valid public proxy hostname or IP address.'
    return false
  }
  if (!Number.isInteger(Number(port.value)) || Number(port.value) < 1 || Number(port.value) > 65_535) {
    errorMessage.value = 'Enter a proxy port from 1 to 65535.'
    return false
  }
  if (username.value.length > 255 || password.value.length > 255) {
    errorMessage.value = 'Proxy credentials must each be 255 characters or fewer.'
    return false
  }
  return true
}

function stopMonitor(): void {
  cancelSampling()
  if (status.value === 'running') {
    status.value = 'done'
    activityMessage.value = 'Monitor stopped. The summary covers only the samples already collected.'
  }
}

function clearMonitor(): void {
  cancelSampling()
  status.value = 'idle'
  samples.value = []
  errorMessage.value = ''
  activityMessage.value = 'Results cleared from this tab.'
}

function stopTimer(): void {
  window.clearTimeout(monitorTimer)
  monitorTimer = 0
}

onUnmounted(cancelSampling)
</script>

<template>
  <div class="app-shell">
    <AppHeader />

    <main class="page-shell">
      <section class="panel hero" aria-labelledby="page-title">
        <div>
          <p class="eyebrow">Bounded route observation</p>
          <h1 id="page-title">Proxy Rotation &amp; Sticky Session Monitor</h1>
          <p class="hero-text">Watch whether a public proxy route stays stable or changes during a short session—without mistaking one observation for a provider guarantee.</p>
        </div>
        <aside class="hero-status">
          <span class="status-pill">No account</span>
          <strong>Summary first. Evidence second.</strong>
          <small>Configured mode makes one same-origin request every five seconds, for at most five minutes.</small>
        </aside>
      </section>

      <div class="mode-switch" role="group" aria-label="Monitoring mode">
        <button class="mode-button" type="button" :data-active="mode === 'configured'" @click="switchMode('configured')">
          <strong>Configured route</strong>
          Browser or system proxy already in use
        </button>
        <button class="mode-button" type="button" :data-active="mode === 'explicit'" @click="switchMode('explicit')">
          <strong>Explicit proxy · Advanced</strong>
          Transient endpoint and credentials
        </button>
      </div>

      <section class="workspace">
        <div class="primary-column">
          <section class="panel" aria-labelledby="monitor-title">
            <p class="eyebrow">{{ mode === 'configured' ? 'Recommended mode' : 'Advanced mode' }}</p>
            <h2 id="monitor-title">{{ mode === 'configured' ? 'Observe the route already configured here' : 'Observe one supplied proxy endpoint' }}</h2>
            <p v-if="mode === 'configured'">This checks the route used by this page. If the proxy is configured only inside another application, this browser result will not represent it.</p>

            <form v-else autocomplete="off" @submit.prevent="startMonitor">
              <p class="warning">
                The endpoint and credentials are transmitted transiently to Aerod’s Worker for every sample. They are not intentionally stored. A successful result only means the Worker reached a fixed IP echo endpoint through that proxy at that moment.
              </p>
              <p v-if="protocol === 'http' && (username || password)" class="warning">
                HTTP proxy authentication is not encrypted between Aerod’s Worker and the proxy. Use HTTPS or SOCKS5 when the proxy supports it, and avoid reusing important credentials.
              </p>
              <div class="field-grid">
                <label class="field">
                  <span>Protocol</span>
                  <select v-model="protocol" class="input">
                    <option value="http">HTTP proxy</option>
                    <option value="https">HTTPS proxy</option>
                    <option value="socks5">SOCKS5</option>
                  </select>
                </label>
                <label class="field">
                  <span>Port</span>
                  <input v-model.number="port" class="input" type="number" min="1" max="65535" inputmode="numeric" />
                </label>
                <label class="field full">
                  <span>Public proxy hostname or IP</span>
                  <input v-model="host" class="input" type="text" autocomplete="off" spellcheck="false" placeholder="proxy.example.net" />
                </label>
                <label class="field">
                  <span>Username (optional)</span>
                  <input v-model="username" class="input" type="text" autocomplete="off" />
                </label>
                <label class="field">
                  <span>Password (optional)</span>
                  <input v-model="password" class="input" type="password" autocomplete="new-password" />
                </label>
              </div>
            </form>

            <div class="button-row">
              <button v-if="status !== 'running'" class="button primary" type="button" @click="startMonitor">
                {{ samples.length ? 'Start a new monitor' : 'Start monitor' }}
              </button>
              <button v-else class="button danger" type="button" @click="stopMonitor">Stop monitor</button>
              <button class="button" type="button" :disabled="!samples.length" @click="clearMonitor">Clear results</button>
            </div>
            <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
            <p class="live-region" aria-live="polite">{{ activityMessage }}</p>
          </section>

          <section class="panel result-panel" :data-tone="summary.tone" aria-labelledby="summary-title" aria-live="polite">
            <span class="status-pill" :data-tone="summary.tone">{{ summary.tone }}</span>
            <h2 id="summary-title">{{ summary.title }}</h2>
            <p>{{ summary.explanation }}</p>
            <div class="metrics">
              <div class="metric"><span>Successful</span><strong>{{ summary.successful }}</strong></div>
              <div class="metric"><span>Unique routes</span><strong>{{ summary.uniqueRoutes }}</strong></div>
              <div class="metric"><span>Route changes</span><strong>{{ summary.changes }}</strong></div>
              <div class="metric"><span>Failures</span><strong>{{ summary.failures }}</strong></div>
            </div>
          </section>

          <details v-if="samples.length" class="panel advanced">
            <summary>Advanced samples and timing ({{ samples.length }})</summary>
            <div class="advanced__body">
              <div class="metrics">
                <div class="metric"><span>Longest stable window</span><strong>{{ formatDuration(summary.longestStableMs) }}</strong></div>
                <div class="metric"><span>Average observed rotation</span><strong>{{ formatDuration(summary.averageRotationMs) }}</strong></div>
              </div>
              <ul class="route-list">
                <li v-for="(sample, index) in samples" :key="`${sample.observedAt}-${index}`">
                  <div>
                    <code>{{ sample.ok ? sample.ip : 'Unavailable' }}</code>
                    <small v-if="sample.ok">{{ sample.family }} · {{ sample.organization || 'Network owner unavailable' }}</small>
                    <small v-else>{{ sample.error || 'Sample failed' }}</small>
                  </div>
                  <time :datetime="sample.observedAt">{{ new Date(sample.observedAt).toLocaleTimeString() }}</time>
                </li>
              </ul>
            </div>
          </details>
        </div>

        <aside class="side-column">
          <section class="panel" aria-labelledby="current-title">
            <p class="eyebrow">Current observation</p>
            <h2 id="current-title">{{ currentSample?.ip || 'No successful sample' }}</h2>
            <ul class="privacy-list">
              <li><strong>Address family</strong>{{ currentSample?.family || 'Unknown' }}</li>
              <li><strong>Network</strong>{{ currentSample?.organization || currentSample?.asn || 'Unavailable' }}</li>
              <li><strong>Edge context</strong>{{ [currentSample?.country, currentSample?.colo].filter(Boolean).join(' · ') || 'Unavailable' }}</li>
            </ul>
          </section>
          <section class="panel" aria-labelledby="limits-title">
            <p class="eyebrow">Interpret carefully</p>
            <h2 id="limits-title">Observation is not a guarantee</h2>
            <p>“Stable” means no change appeared during these samples. It does not prove future stickiness, target-site compatibility, anonymity, or browser configuration outside this page.</p>
          </section>
        </aside>
      </section>
    </main>
  </div>
</template>
