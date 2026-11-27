/**
 * Small HTTP load generator for NON-PRODUCTION targets (no dependencies).
 *
 *   node backend/scripts/loadtest.mjs --url http://127.0.0.1:10000/healthz --concurrency 20 --duration 30
 *
 * Refuses any host that is not localhost unless it is listed in LOADTEST_ALLOWED_HOSTS (comma-separated),
 * so it cannot be pointed at the live Render/Vercel deployment by accident. Extra headers: --header "Name: value".
 * Prints requests/s, latency percentiles and the status-code mix.
 */
import { pathToFileURL } from 'node:url'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function assertNonProductionTarget(rawUrl, allowed = process.env.LOADTEST_ALLOWED_HOSTS || '') {
  const { hostname } = new URL(rawUrl)
  const allowList = new Set(allowed.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean))
  if (LOCAL_HOSTS.has(hostname) || allowList.has(hostname.toLowerCase())) return hostname
  throw new Error(`Refusing to load-test "${hostname}": only localhost or hosts in LOADTEST_ALLOWED_HOSTS (a staging environment) are allowed.`)
}

export function percentile(sortedMs, p) {
  if (!sortedMs.length) return 0
  return sortedMs[Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1)]
}

export async function runLoad({ url, concurrency = 10, durationSec = 10, headers = {}, method = 'GET', body } = {}) {
  assertNonProductionTarget(url)
  const latencies = []
  const statuses = {}
  const deadline = Date.now() + durationSec * 1000
  const worker = async () => {
    while (Date.now() < deadline) {
      const started = performance.now()
      let key
      try {
        const res = await fetch(url, { method, headers, body })
        await res.arrayBuffer()
        key = String(res.status)
      } catch (err) {
        key = `error:${err?.cause?.code || err?.name || 'unknown'}`
      }
      latencies.push(performance.now() - started)
      statuses[key] = (statuses[key] || 0) + 1
    }
  }
  const t0 = performance.now()
  await Promise.all(Array.from({ length: concurrency }, worker))
  const elapsedSec = (performance.now() - t0) / 1000
  latencies.sort((a, b) => a - b)
  return {
    requests: latencies.length,
    rps: latencies.length / elapsedSec,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies.at(-1) ?? 0,
    statuses,
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2)
  const get = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback }
  const headers = {}
  args.forEach((a, i) => { if (a === '--header') { const [k, ...v] = args[i + 1].split(':'); headers[k.trim()] = v.join(':').trim() } })
  const result = await runLoad({
    url: get('url'), concurrency: Number(get('concurrency', 10)), durationSec: Number(get('duration', 10)),
    method: get('method', 'GET'), body: get('body'), headers,
  })
  console.log(`${result.requests} requests, ${result.rps.toFixed(1)} req/s | p50 ${result.p50.toFixed(1)} ms, p95 ${result.p95.toFixed(1)} ms, p99 ${result.p99.toFixed(1)} ms, max ${result.max.toFixed(1)} ms | statuses ${JSON.stringify(result.statuses)}`)
}
