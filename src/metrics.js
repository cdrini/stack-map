import { REFRESH_INTERVAL_MS } from './liveRefresh.js'

const API_BASE = 'http://localhost:8000'

// Substitutes `{{id}}` in a metric's `query` template with the id of
// whatever entity it's attached to — see the `metrics` doc comment at the
// top of stack.yaml.
export function resolveMetricQuery(metric, resourceId) {
  return metric.query.replaceAll('{{id}}', resourceId)
}

// Toggling "Group by server" unmounts every VmBox (and every CpuBadge/
// MemBadge inside it) and remounts a fresh set for the other layout —
// each one would otherwise re-fetch from scratch and show "…" until data
// comes back, even though the actual values are probably still current.
// A value already fetched within the last refresh window is reused
// instead of re-requested — it wouldn't have changed from a real refresh
// yet either. Keyed on (source, query) rather than resourceId since
// that's the actual unit of request/response; module-level so it survives
// component unmount/remount (this file is a singleton for the page).
// Only successes are cached — an error shouldn't get "stuck" for the
// whole window when a retry might succeed.
const resultCache = new Map() // `${source}::${query}` -> { result, fetchedAt }

function cacheKey(source, query) {
  return `${source}::${query}`
}

// Every badge on the map calls fetchLatestMetric independently, but they
// mostly do it in synchronized bursts — everything fetches once on mount,
// then again together on every liveRefresh tick (they all watch the same
// refreshTick). With ~20 resources needing up to ~11 metrics each, that's
// 200+ individual requests per burst if sent one-by-one. Graphite's
// /render accepts multiple `target` params in one call, so this batches
// same-source calls that land within a short window into chunks of
// BATCH_SIZE instead — not all of them in a single request (a single
// 200-target call risks being slow enough to itself become the
// bottleneck, confirmed empirically: a 10-target call already took ~1s),
// but far fewer than one request per metric.
//
// Chunks are packed by resourceId (never split one resource's metrics
// across two requests) rather than sliced blindly in queue order — so a
// VM's CPU and RAM badges land in the same response and update together,
// instead of some fields refreshing a beat ahead of others depending on
// which chunk happened to catch them. A resource needing more than
// BATCH_SIZE metrics still gets one chunk to itself (kept whole rather
// than split, at the cost of exceeding the target size) rather than being
// torn across two requests.
const BATCH_SIZE = 10
const BATCH_WINDOW_MS = 50

let pendingBySource = new Map() // source -> [{ query, resourceId, resolve, reject }]
let flushTimer = null

function scheduleFlush() {
  if (flushTimer !== null) return
  flushTimer = setTimeout(flushBatches, BATCH_WINDOW_MS)
}

function chunkByResource(items, targetSize) {
  const byResource = new Map()
  for (const item of items) {
    if (!byResource.has(item.resourceId)) byResource.set(item.resourceId, [])
    byResource.get(item.resourceId).push(item)
  }

  const chunks = []
  let current = []
  for (const group of byResource.values()) {
    if (current.length > 0 && current.length + group.length > targetSize) {
      chunks.push(current)
      current = []
    }
    current.push(...group)
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function flushBatches() {
  flushTimer = null
  const bySource = pendingBySource
  pendingBySource = new Map()

  for (const [source, items] of bySource) {
    for (const chunk of chunkByResource(items, BATCH_SIZE)) {
      fetchChunk(source, chunk)
    }
  }
}

async function fetchChunk(source, items) {
  const params = new URLSearchParams({ source })
  for (const item of items) params.append('query', item.query)

  try {
    const res = await fetch(`${API_BASE}/api/metrics/latest?${params}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    for (const item of items) {
      const result = data[item.query]
      if (result) item.resolve(result)
      else item.reject(new Error(`no data for ${item.query}`))
    }
  } catch (e) {
    for (const item of items) item.reject(e)
  }
}

function fetchOne(source, query, resourceId) {
  const key = cacheKey(source, query)
  const cached = resultCache.get(key)
  if (cached && Date.now() - cached.fetchedAt < REFRESH_INTERVAL_MS) {
    return Promise.resolve(cached.result)
  }

  return new Promise((resolve, reject) => {
    if (!pendingBySource.has(source)) pendingBySource.set(source, [])
    pendingBySource.get(source).push({
      query,
      resourceId,
      resolve: (result) => {
        resultCache.set(key, { result, fetchedAt: Date.now() })
        resolve(result)
      },
      reject,
    })
    scheduleFlush()
  })
}

export async function fetchLatestMetric(metric, resourceId) {
  return fetchOne(metric.source, resolveMetricQuery(metric, resourceId), resourceId)
}

// `cpu-*` and `mem-*`/`swap-*` each render as one composite widget
// (CpuBadge.vue / MemBadge.vue) rather than one badge per raw metric — this
// splits a resource's full metrics list into those two families plus
// everything else, so the caller can render each family once and hand
// whatever's left to the generic per-metric badge.
const CPU_METRIC_TYPES = new Set(['cpu-busy', 'cpu-wait', 'cpu-steal'])
const RAM_METRIC_TYPES = new Set([
  'mem-used',
  'mem-free',
  'mem-cached',
  'mem-buffered',
  'mem-slab-recl',
  'mem-slab-unrecl',
  'swap-used',
  'swap-free',
])

export function partitionMetricFamilies(metrics) {
  const cpuMetrics = metrics.filter((m) => CPU_METRIC_TYPES.has(m.type))
  const ramMetrics = metrics.filter((m) => RAM_METRIC_TYPES.has(m.type))
  const otherMetrics = metrics.filter(
    (m) => !CPU_METRIC_TYPES.has(m.type) && !RAM_METRIC_TYPES.has(m.type)
  )
  return { cpuMetrics, ramMetrics, otherMetrics }
}

const WAIT_THRESHOLD = 10 // % — above this, treat as disk/network-bound, not just "busy"
const STEAL_THRESHOLD = 5 // % — above this, the VM host itself looks oversubscribed

// `cpuMetrics` is whatever subset of cpu-busy/cpu-wait/cpu-steal this
// resource actually has (from partitionMetricFamilies) — wait/steal are
// optional, cpu-busy is not.
export async function fetchCpuMetrics(cpuMetrics, resourceId) {
  const byType = Object.fromEntries(cpuMetrics.map((m) => [m.type, m]))
  const busyMetric = byType['cpu-busy']
  if (!busyMetric) throw new Error('cpu-busy metric not configured for this resource')

  const [idle, wait, steal] = await Promise.allSettled([
    fetchLatestMetric(busyMetric, resourceId),
    byType['cpu-wait']
      ? fetchLatestMetric(byType['cpu-wait'], resourceId)
      : Promise.reject(new Error('cpu-wait not configured')),
    byType['cpu-steal']
      ? fetchLatestMetric(byType['cpu-steal'], resourceId)
      : Promise.reject(new Error('cpu-steal not configured')),
  ])

  if (idle.status !== 'fulfilled') {
    throw new Error(idle.reason instanceof Error ? idle.reason.message : String(idle.reason))
  }

  return {
    busy: 100 - idle.value.value,
    wait: wait.status === 'fulfilled' ? wait.value.value : null,
    waitElevated: wait.status === 'fulfilled' && wait.value.value > WAIT_THRESHOLD,
    steal: steal.status === 'fulfilled' ? steal.value.value : null,
    stealElevated: steal.status === 'fulfilled' && steal.value.value > STEAL_THRESHOLD,
  }
}

const SWAP_THRESHOLD = 1 // % — collectd, unlike CPU, has no pre-aggregated memory %; any
// meaningful swapping is worth flagging even at low percentages, since it
// means real RAM pressure, not just "somewhat full"

const RAM_RAW_TYPES = ['mem-used', 'mem-free', 'mem-cached', 'mem-buffered', 'mem-slab-recl', 'mem-slab-unrecl']

// `ramMetrics` is whatever subset of the mem-*/swap-* family this resource
// actually has (from partitionMetricFamilies) — all six mem-* types are
// required (they're what total RAM and "used" are computed from); swap-*
// is optional.
export async function fetchRamMetrics(ramMetrics, resourceId) {
  const byType = Object.fromEntries(ramMetrics.map((m) => [m.type, m]))
  if (!RAM_RAW_TYPES.every((t) => byType[t])) {
    throw new Error('memory metrics not fully configured for this resource')
  }

  const [used, free, cached, buffered, slabRecl, slabUnrecl, swapUsed, swapFree] =
    await Promise.allSettled([
      ...RAM_RAW_TYPES.map((t) => fetchLatestMetric(byType[t], resourceId)),
      byType['swap-used']
        ? fetchLatestMetric(byType['swap-used'], resourceId)
        : Promise.reject(new Error('swap-used not configured')),
      byType['swap-free']
        ? fetchLatestMetric(byType['swap-free'], resourceId)
        : Promise.reject(new Error('swap-free not configured')),
    ])

  const memResults = [used, free, cached, buffered, slabRecl, slabUnrecl]
  const failed = memResults.find((r) => r.status !== 'fulfilled')
  if (failed) {
    throw new Error(failed.reason instanceof Error ? failed.reason.message : String(failed.reason))
  }

  const [usedB, freeB, cachedB, bufferedB, slabReclB, slabUnreclB] = memResults.map(
    (r) => r.value.value
  )
  // cached/buffered/slab-recl are reclaimable — Linux hands them back
  // instantly under pressure, so they're excluded from "used" or every
  // healthy box would read as constantly ~90%+ full.
  const total = usedB + freeB + cachedB + bufferedB + slabReclB + slabUnreclB
  const busy = ((usedB + slabUnreclB) / total) * 100

  let swapPercent = null
  if (swapUsed.status === 'fulfilled' && swapFree.status === 'fulfilled') {
    const swapTotal = swapUsed.value.value + swapFree.value.value
    swapPercent = swapTotal > 0 ? (swapUsed.value.value / swapTotal) * 100 : 0
  }

  return {
    busy,
    usedBytes: usedB + slabUnreclB,
    totalBytes: total,
    swapPercent,
    swapElevated: swapPercent !== null && swapPercent > SWAP_THRESHOLD,
  }
}

// Binary GiB (1024^3), matching how collectd/the kernel actually count RAM
// (what tools like `free`/`htop` show, even though they usually label it
// "GB") — not decimal/SI gigabytes.
export function formatGiB(bytes, decimals = 1) {
  return (bytes / 1024 ** 3).toFixed(decimals)
}

// Healthy → red as busy % climbs. CPU and RAM get different curves because
// they fail differently: CPU degrades gradually (queueing delay creeps up
// well before 100%), so a moderate threshold catches an early warning
// sign. RAM's danger is a hard cliff right near the top (OOM kill / swap)
// — 80-85% used is normal, healthy Linux behavior, not a problem — so it
// stays "healthy" much higher and only turns red close to the ceiling.
// The healthy tier is deliberately `plain` (no color/bold) rather than
// green — a badge should only draw the eye when there's something to
// look at, not for every normal reading.
const CPU_BUSY_TIERS = [
  { max: 50, plain: true }, // healthy
  { max: 75, color: '#854d0e', background: '#fef9c3' }, // yellow
  { max: 90, color: '#9a3412', background: '#ffedd5' }, // orange
  { max: Infinity, color: '#b91c1c', background: '#fee2e2' }, // red
]

const RAM_BUSY_TIERS = [
  { max: 80, plain: true }, // healthy
  { max: 90, color: '#854d0e', background: '#fef9c3' }, // yellow
  { max: 95, color: '#9a3412', background: '#ffedd5' }, // orange
  { max: Infinity, color: '#b91c1c', background: '#fee2e2' }, // red
]

export function cpuBusyColor(busyPercent) {
  return CPU_BUSY_TIERS.find((tier) => busyPercent < tier.max) ?? CPU_BUSY_TIERS.at(-1)
}

export function ramBusyColor(busyPercent) {
  return RAM_BUSY_TIERS.find((tier) => busyPercent < tier.max) ?? RAM_BUSY_TIERS.at(-1)
}
