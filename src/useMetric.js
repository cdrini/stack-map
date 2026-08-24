import { onMounted, ref, watch } from 'vue'
import { refreshTick } from './liveRefresh.js'
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
  let hasSettledOnce = false

  async function load() {
    try {
      data.value = await loader()
      status.value = 'ok'
    } catch (e) {
      errorMessage.value = e instanceof Error ? e.message : String(e)
      status.value = 'error'
    }
    if (!hasSettledOnce) {
      hasSettledOnce = true
      onSettled?.()
    }
  }

  onMounted(load)
  watch(refreshTick, load)
  watch(effectiveRewindTime, load)

  return { status, data, errorMessage }
}
