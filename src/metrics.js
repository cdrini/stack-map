import { ref } from 'vue'
import { REFRESH_INTERVAL_MS } from './liveRefresh.js'

const API_BASE = 'http://localhost:8000'

// How many metric fetches are outstanding right now, and how many the
// current batch started with — a cache hit never touches either (nothing's
// actually being requested), only a genuine pending network round trip
// does. MapView.vue's toolbar divides the two into a completed fraction
// for a circular progress indicator, rather than just a binary
// "refreshing or not". `pendingRequestTotal` resets to 0 once the count
// drains back to 0, so the next batch starts counting fresh instead of
// accumulating across refreshes.
export const pendingRequestTotal = ref(0)
export const pendingRequestCount = ref(0)

function trackPending() {
  pendingRequestCount.value++
  pendingRequestTotal.value++
}

function untrackPending() {
  pendingRequestCount.value--
  if (pendingRequestCount.value === 0) pendingRequestTotal.value = 0
}

// haproxy-*/solr-* metrics are Prometheus-backed rather than Graphite-backed
// — this is the one thing that decides which backend endpoint a chunk of
// same-source queries goes to (see fetchChunk).
const PROMETHEUS_SOURCE = 'http://ux-log0.us.archive.org:9090'

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
// Failures are cached here too, same as successes — a resource with no
// data at all (e.g. a VM with no collectd agent) fails the exact same way
// on every retry, so without this every "Group by server" toggle (which
// remounts every badge) was re-firing, and re-failing, the same doomed
// request. A stuck error just rides out the same 30s window a stale
// success would; a manual page reload bypasses the cache entirely if
// something needs an immediate retry sooner than that.
const resultCache = new Map() // `${source}::${query}` -> { result, error, fetchedAt }

function cacheKey(source, query) {
  return `${source}::${query}`
}

// For the toolbar's manual refresh button — bypasses the 30s window
// entirely so a forced refresh actually re-fetches everything, rather than
// just re-triggering `load()` calls that immediately resolve from a cache
// that hasn't expired yet.
export function clearResultCache() {
  resultCache.clear()
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

  const endpoint = source === PROMETHEUS_SOURCE ? '/api/metrics/prometheus/latest' : '/api/metrics/latest'
  try {
    const res = await fetch(`${API_BASE}${endpoint}?${params}`)
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
    return cached.error ? Promise.reject(cached.error) : Promise.resolve(cached.result)
  }

  trackPending()
  return new Promise((resolve, reject) => {
    if (!pendingBySource.has(source)) pendingBySource.set(source, [])
    pendingBySource.get(source).push({
      query,
      resourceId,
      resolve: (result) => {
        resultCache.set(key, { result, fetchedAt: Date.now() })
        untrackPending()
        resolve(result)
      },
      reject: (err) => {
        resultCache.set(key, { error: err, fetchedAt: Date.now() })
        untrackPending()
        reject(err)
      },
    })
    scheduleFlush()
  })
}

export async function fetchLatestMetric(metric, resourceId) {
  return fetchOne(metric.source, resolveMetricQuery(metric, resourceId), resourceId)
}

// `cpu-*`, `mem-*`/`swap-*`, and `disk-*` each render as one composite
// widget (CpuBadge.vue / MemBadge.vue / DiskBadge.vue) rather than one
// badge per raw metric — this splits a resource's full metrics list into
// those families plus everything else, so the caller can render each
// family once and hand whatever's left to the generic per-metric badge.
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
const DISK_METRIC_TYPES = new Set(['disk-busy', 'disk-pending'])
const HAPROXY_METRIC_TYPES = new Set([
  'haproxy-sessions',
  'haproxy-limit',
  'haproxy-queue',
  'haproxy-up',
  'haproxy-total',
])
const SOLR_METRIC_TYPES = new Set(['solr-request-rate', 'solr-error-rate', 'solr-timeout-rate'])

export function partitionMetricFamilies(metrics) {
  const cpuMetrics = metrics.filter((m) => CPU_METRIC_TYPES.has(m.type))
  const ramMetrics = metrics.filter((m) => RAM_METRIC_TYPES.has(m.type))
  const diskMetrics = metrics.filter((m) => DISK_METRIC_TYPES.has(m.type))
  const haproxyMetrics = metrics.filter((m) => HAPROXY_METRIC_TYPES.has(m.type))
  const solrMetrics = metrics.filter((m) => SOLR_METRIC_TYPES.has(m.type))
  const otherMetrics = metrics.filter(
    (m) =>
      !CPU_METRIC_TYPES.has(m.type) &&
      !RAM_METRIC_TYPES.has(m.type) &&
      !DISK_METRIC_TYPES.has(m.type) &&
      !HAPROXY_METRIC_TYPES.has(m.type) &&
      !SOLR_METRIC_TYPES.has(m.type)
  )
  return { cpuMetrics, ramMetrics, diskMetrics, haproxyMetrics, solrMetrics, otherMetrics }
}

// A VM with multiple disks (see stack.yaml's `disks:` field) has its
// disk-busy/disk-pending metrics expanded once per device by spec.js's
// metricsFor, each tagged with a `disk` field — this regroups them back by
// device so each gets its own DiskBadge row instead of being shown as one
// conflated family, since disks on the same VM can have very different
// roles (e.g. data vs. WAL) that would be misleading to average together.
// Sorted by device name for a stable, predictable row order.
export function groupDiskMetricsByDisk(diskMetrics) {
  const byDisk = new Map()
  for (const m of diskMetrics) {
    const disk = m.disk ?? 'vda'
    if (!byDisk.has(disk)) byDisk.set(disk, [])
    byDisk.get(disk).push(m)
  }
  return [...byDisk.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([disk, metrics]) => ({ disk, metrics }))
}

// Same idea as groupDiskMetricsByDisk, for haproxy containers that front
// more than one backend pool (see stack.yaml's doc comment on `backend`) —
// groups this container's haproxy-* metrics back by backend so each pool
// gets its own HaproxyBadge row. Sorted by backend name for a stable order.
export function groupHaproxyMetricsByBackend(haproxyMetrics) {
  const byBackend = new Map()
  for (const m of haproxyMetrics) {
    if (!byBackend.has(m.backend)) byBackend.set(m.backend, [])
    byBackend.get(m.backend).push(m)
  }
  return [...byBackend.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([backend, metrics]) => ({ backend, metrics }))
}

// Same idea again, for a solr container's per-handler metrics (see
// stack.yaml's doc comment on `handler`) — groups back by handler
// (/select, /get, /update, ...) so each gets its own SolrBadge row.
// Ordered explicitly (not alphabetically) since these read best as
// "the endpoint users actually search with" first.
const SOLR_HANDLER_ORDER = ['/select', '/get', '/update', '/query', '/export', '/replication']
export function groupSolrMetricsByHandler(solrMetrics) {
  const byHandler = new Map()
  for (const m of solrMetrics) {
    if (!byHandler.has(m.handler)) byHandler.set(m.handler, [])
    byHandler.get(m.handler).push(m)
  }
  return [...byHandler.entries()]
    .sort(([a], [b]) => SOLR_HANDLER_ORDER.indexOf(a) - SOLR_HANDLER_ORDER.indexOf(b))
    .map(([handler, metrics]) => ({ handler, metrics }))
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

const PENDING_THRESHOLD = 1 // queued ops — above this, requests are actually backing up,
// not just an occasional single-op blip (healthy VMs sit at 0 essentially always)

// `diskMetrics` is whatever subset of disk-busy/disk-pending this resource
// actually has (from partitionMetricFamilies) — disk-pending is optional,
// disk-busy is not.
export async function fetchDiskMetrics(diskMetrics, resourceId) {
  const byType = Object.fromEntries(diskMetrics.map((m) => [m.type, m]))
  const busyMetric = byType['disk-busy']
  if (!busyMetric) throw new Error('disk-busy metric not configured for this resource')

  const [ioTime, pending] = await Promise.allSettled([
    fetchLatestMetric(busyMetric, resourceId),
    byType['disk-pending']
      ? fetchLatestMetric(byType['disk-pending'], resourceId)
      : Promise.reject(new Error('disk-pending not configured')),
  ])

  if (ioTime.status !== 'fulfilled') {
    throw new Error(ioTime.reason instanceof Error ? ioTime.reason.message : String(ioTime.reason))
  }

  // disk_io_time.io_time is collectd's ms-of-I/O-per-second rate (0-1000),
  // i.e. the same thing `iostat %util` shows — divide by 10 for 0-100%.
  return {
    busy: ioTime.value.value / 10,
    pending: pending.status === 'fulfilled' ? pending.value.value : null,
    pendingElevated: pending.status === 'fulfilled' && pending.value.value > PENDING_THRESHOLD,
  }
}

// queued requests — above this, the backend can't keep up with demand right
// now (healthy backends sit at 0 essentially always, same role as
// disk-pending)
const QUEUE_THRESHOLD = 0

// `haproxyMetrics` is whatever subset of haproxy-sessions/-limit/-queue/-up/
// -total this backend actually has (from groupHaproxyMetricsByBackend) —
// sessions and limit are required (they're what busy % is computed from);
// queue/up/total are optional.
export async function fetchHaproxyMetrics(haproxyMetrics, resourceId) {
  const byType = Object.fromEntries(haproxyMetrics.map((m) => [m.type, m]))
  const sessionsMetric = byType['haproxy-sessions']
  const limitMetric = byType['haproxy-limit']
  if (!sessionsMetric || !limitMetric) {
    throw new Error('haproxy-sessions/haproxy-limit not configured for this backend')
  }

  const [sessions, limit, queue, up, total] = await Promise.allSettled([
    fetchLatestMetric(sessionsMetric, resourceId),
    fetchLatestMetric(limitMetric, resourceId),
    byType['haproxy-queue']
      ? fetchLatestMetric(byType['haproxy-queue'], resourceId)
      : Promise.reject(new Error('haproxy-queue not configured')),
    byType['haproxy-up']
      ? fetchLatestMetric(byType['haproxy-up'], resourceId)
      : Promise.reject(new Error('haproxy-up not configured')),
    byType['haproxy-total']
      ? fetchLatestMetric(byType['haproxy-total'], resourceId)
      : Promise.reject(new Error('haproxy-total not configured')),
  ])

  if (sessions.status !== 'fulfilled' || limit.status !== 'fulfilled') {
    const failed = sessions.status !== 'fulfilled' ? sessions : limit
    throw new Error(failed.reason instanceof Error ? failed.reason.message : String(failed.reason))
  }

  const upCount = up.status === 'fulfilled' ? up.value.value : null
  const totalCount = total.status === 'fulfilled' ? total.value.value : null

  return {
    busy: (sessions.value.value / limit.value.value) * 100,
    sessions: sessions.value.value,
    queue: queue.status === 'fulfilled' ? queue.value.value : null,
    queueElevated: queue.status === 'fulfilled' && queue.value.value > QUEUE_THRESHOLD,
    up: upCount,
    total: totalCount,
    // Only flagged once both numbers are actually known — a missing metric
    // shouldn't read as "servers are down".
    healthDegraded: upCount !== null && totalCount !== null && upCount < totalCount,
  }
}

// Both turned out to have a small persistent background trickle even when
// healthy, rather than sitting at exact 0% the way disk-pending/
// haproxy-queue do — observed live at ~0.001-0.003% for errors and
// ~0.01-0.03% for timeouts across all three solr VMs. Each threshold is
// set with headroom above its own noise floor rather than sharing one
// number, since the two floors differ by roughly 10x. Worth revisiting
// with more data.
const ERROR_RATE_THRESHOLD = 0.01
const TIMEOUT_RATE_THRESHOLD = 0.1

function safePercent(part, whole) {
  return whole > 0 ? (part / whole) * 100 : 0
}

// `solrMetrics` is whatever subset of solr-request-rate/-error-rate/
// -timeout-rate this container actually has — request-rate is required
// (it's the denominator error/timeout are expressed as a % of); the other
// two are optional. Unlike the busy-% families, request rate itself isn't
// colored — more traffic isn't inherently bad, so it's shown as a plain
// figure and only the error/timeout %s (which do have a clear "healthy is
// near zero" direction) get call-outs.
export async function fetchSolrMetrics(solrMetrics, resourceId) {
  const byType = Object.fromEntries(solrMetrics.map((m) => [m.type, m]))
  const requestRateMetric = byType['solr-request-rate']
  if (!requestRateMetric) throw new Error('solr-request-rate not configured for this resource')

  const [requestRate, errorRate, timeoutRate] = await Promise.allSettled([
    fetchLatestMetric(requestRateMetric, resourceId),
    byType['solr-error-rate']
      ? fetchLatestMetric(byType['solr-error-rate'], resourceId)
      : Promise.reject(new Error('solr-error-rate not configured')),
    byType['solr-timeout-rate']
      ? fetchLatestMetric(byType['solr-timeout-rate'], resourceId)
      : Promise.reject(new Error('solr-timeout-rate not configured')),
  ])

  if (requestRate.status !== 'fulfilled') {
    throw new Error(requestRate.reason instanceof Error ? requestRate.reason.message : String(requestRate.reason))
  }

  const rps = requestRate.value.value
  const errorPercent = errorRate.status === 'fulfilled' ? safePercent(errorRate.value.value, rps) : null
  const timeoutPercent = timeoutRate.status === 'fulfilled' ? safePercent(timeoutRate.value.value, rps) : null

  return {
    requestsPerSecond: rps,
    errorPercent,
    errorElevated: errorPercent !== null && errorPercent > ERROR_RATE_THRESHOLD,
    timeoutPercent,
    timeoutElevated: timeoutPercent !== null && timeoutPercent > TIMEOUT_RATE_THRESHOLD,
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

// Disk saturation causes immediate queueing/latency, same shape as CPU
// (not RAM's forgiving-until-the-cliff curve), so it shares CPU's
// thresholds rather than RAM's — kept as its own tier list, not a shared
// reference, so the two can be tuned independently later if warranted.
const DISK_BUSY_TIERS = [
  { max: 50, plain: true }, // healthy
  { max: 75, color: '#854d0e', background: '#fef9c3' }, // yellow
  { max: 90, color: '#9a3412', background: '#ffedd5' }, // orange
  { max: Infinity, color: '#b91c1c', background: '#fee2e2' }, // red
]

// Unverified first guess, not empirically tuned like the others — sessions
// vs. a configured limit is a saturation signal much like disk busy %, but
// we haven't yet seen what "normal" looks like in practice for these
// specific backends. Worth revisiting once this badge has been watched for
// a while.
const HAPROXY_SESSIONS_TIERS = [
  { max: 50, plain: true }, // healthy
  { max: 75, color: '#854d0e', background: '#fef9c3' }, // yellow
  { max: 90, color: '#9a3412', background: '#ffedd5' }, // orange
  { max: Infinity, color: '#b91c1c', background: '#fee2e2' }, // red
]

export function cpuBusyColor(busyPercent) {
  return CPU_BUSY_TIERS.find((tier) => busyPercent < tier.max) ?? CPU_BUSY_TIERS.at(-1)
}

export function ramBusyColor(busyPercent) {
  return RAM_BUSY_TIERS.find((tier) => busyPercent < tier.max) ?? RAM_BUSY_TIERS.at(-1)
}

export function diskBusyColor(busyPercent) {
  return DISK_BUSY_TIERS.find((tier) => busyPercent < tier.max) ?? DISK_BUSY_TIERS.at(-1)
}

export function haproxySessionsColor(busyPercent) {
  return HAPROXY_SESSIONS_TIERS.find((tier) => busyPercent < tier.max) ?? HAPROXY_SESSIONS_TIERS.at(-1)
}

// Whether a badge is showing the worst (red) tier of its own busy-%
// curve — checked by identity against that curve's own last entry rather
// than a re-typed threshold, so there's exactly one place (the tier list
// above) that defines what "red" means for each metric. Used to flag a
// VM's whole box border when any metric on it has gone critical, not just
// to color the individual chip.
export function isCpuBusyCritical(busyPercent) {
  return cpuBusyColor(busyPercent) === CPU_BUSY_TIERS.at(-1)
}

export function isRamBusyCritical(busyPercent) {
  return ramBusyColor(busyPercent) === RAM_BUSY_TIERS.at(-1)
}

export function isDiskBusyCritical(busyPercent) {
  return diskBusyColor(busyPercent) === DISK_BUSY_TIERS.at(-1)
}

export function isHaproxySessionsCritical(busyPercent) {
  return haproxySessionsColor(busyPercent) === HAPROXY_SESSIONS_TIERS.at(-1)
}
