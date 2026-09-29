import { computed, onMounted, ref, watch } from 'vue'
import { REFRESH_INTERVAL_MS, clockTick, liveRefreshEnabled, refreshTick } from './liveRefresh.js'
import { effectiveRewindTime } from './rewind.js'

// Centralizes the mount+refresh+status/error lifecycle every metric badge
// (CpuBadge, MemBadge, DiskBadge, HaproxyBadge, SolrBadge, MetricBadge)
// used to duplicate — `loader` is whatever async fetch that badge needs
// (fetchCpuMetrics, fetchLatestMetric, ...), left specific to each family,
// but WHEN it's called and how loading/error state is tracked is now one
// shared place. Case in point: also reloading on effectiveRewindTime
// changes (on top of the normal refresh tick) only had to happen here,
// once, instead of in every badge component individually.
//
// On failure, `data` simply keeps its last successful value rather than
// being cleared — a failed refresh doesn't mean the previous reading is
// now wrong, which every badge already relied on; a plain ref naturally
// provides that as long as `load()` only ever reassigns `data.value` in
// the try branch, never the catch branch.
export function useMetric(loader, onSettled) {
  const status = ref('loading') // 'loading' | 'ok' | 'error'
  const data = ref(null)
  const errorMessage = ref('')
  const loadedAt = ref(null)
  let hasSettledOnce = false

  async function load() {
    try {
      data.value = await loader()
      status.value = 'ok'
      loadedAt.value = Date.now()
    } catch (e) {
      errorMessage.value = e instanceof Error ? e.message : String(e)
      status.value = 'error'
    }
    if (!hasSettledOnce) {
      hasSettledOnce = true
      onSettled?.()
    }
  }

  // Whether what's on screen has outlived the refresh that should have
  // replaced it — the cue for a badge to flash (see each badge's root class
  // and style.css's `metric-stale`). Measured from when a value last
  // arrived, NOT from the datapoint's own timestamp: Graphite and Prometheus
  // hand back points at their own resolution (tens of seconds), so a
  // perfectly healthy reading is routinely older than that and would flash
  // constantly. A failed refresh leaves `loadedAt` alone, so a badge holding
  // its last good value correctly ages into staleness.
  //
  // Only meaningful while live refresh is on: with it off, nothing is coming
  // to replace the value, so calling it stale would be nagging about a state
  // the viewer chose.
  const isStale = computed(
    () =>
      liveRefreshEnabled.value &&
      loadedAt.value !== null &&
      clockTick.value - loadedAt.value > REFRESH_INTERVAL_MS
  )

  onMounted(load)
  watch(refreshTick, load)
  watch(effectiveRewindTime, load)

  return { status, data, errorMessage, isStale }
}
