const API_BASE = 'http://localhost:8000'

// Substitutes `{{id}}` in a metric's `query` template with the id of
// whatever entity it's attached to — see the `metrics` doc comment at the
// top of stack.yaml.
export function resolveMetricQuery(metric, resourceId) {
  return metric.query.replaceAll('{{id}}', resourceId)
}

async function fetchOne(source, query) {
  const params = new URLSearchParams({ source, query })
  const res = await fetch(`${API_BASE}/api/metrics/latest?${params}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchLatestMetric(metric, resourceId) {
  return fetchOne(metric.source, resolveMetricQuery(metric, resourceId))
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

// Green → red as busy % climbs. CPU and RAM get different curves because
// they fail differently: CPU degrades gradually (queueing delay creeps up
// well before 100%), so a moderate threshold catches an early warning
// sign. RAM's danger is a hard cliff right near the top (OOM kill / swap)
// — 80-85% used is normal, healthy Linux behavior, not a problem — so it
// stays green much higher and only turns red close to the ceiling.
const CPU_BUSY_TIERS = [
  { max: 50, color: '#15803d', background: '#dcfce7' }, // green
  { max: 75, color: '#854d0e', background: '#fef9c3' }, // yellow
  { max: 90, color: '#9a3412', background: '#ffedd5' }, // orange
  { max: Infinity, color: '#b91c1c', background: '#fee2e2' }, // red
]

const RAM_BUSY_TIERS = [
  { max: 80, color: '#15803d', background: '#dcfce7' }, // green
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
