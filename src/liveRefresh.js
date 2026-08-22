import { ref, watch } from 'vue'

// Exported so metrics.js's short-lived cache can use the exact same window
// — a value is "fresh" for as long as a refresh wouldn't have happened yet.
export const REFRESH_INTERVAL_MS = 30_000

// Shared across every CpuMonitor instance — one toggle, one timer, not
// per-component, so they all refresh in lockstep.
export const liveRefreshEnabled = ref(true)
export const refreshTick = ref(0)

let intervalId = null

watch(
  liveRefreshEnabled,
  (enabled) => {
    if (enabled && !intervalId) {
      intervalId = setInterval(() => {
        refreshTick.value++
      }, REFRESH_INTERVAL_MS)
    } else if (!enabled && intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  },
  { immediate: true }
)
