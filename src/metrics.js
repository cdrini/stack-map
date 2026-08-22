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

// `cpu-busy` / `cpu-wait` / `cpu-steal` render as one composite widget
// (CpuBadge.vue) rather than three independent badges — this pulls them out
// of a resource's full metrics list so the caller can render them together
// and hand everything else to the generic per-metric badge.
const CPU_METRIC_TYPES = new Set(['cpu-busy', 'cpu-wait', 'cpu-steal'])

export function partitionCpuMetrics(metrics) {
  const cpuMetrics = metrics.filter((m) => CPU_METRIC_TYPES.has(m.type))
  const otherMetrics = metrics.filter((m) => !CPU_METRIC_TYPES.has(m.type))
  return { cpuMetrics, otherMetrics }
}

const WAIT_THRESHOLD = 10 // % — above this, treat as disk/network-bound, not just "busy"
const STEAL_THRESHOLD = 5 // % — above this, the VM host itself looks oversubscribed

// `cpuMetrics` is whatever subset of cpu-busy/cpu-wait/cpu-steal this
// resource actually has (from partitionCpuMetrics) — wait/steal are
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

// Green → red as CPU busy % climbs. Thresholds are a starting guess, not
// tuned against any real incident history yet.
const CPU_BUSY_TIERS = [
  { max: 50, color: '#15803d', background: '#dcfce7' }, // green
  { max: 75, color: '#854d0e', background: '#fef9c3' }, // yellow
  { max: 90, color: '#9a3412', background: '#ffedd5' }, // orange
  { max: Infinity, color: '#b91c1c', background: '#fee2e2' }, // red
]

export function cpuBusyColor(busyPercent) {
  return CPU_BUSY_TIERS.find((tier) => busyPercent < tier.max) ?? CPU_BUSY_TIERS.at(-1)
}
