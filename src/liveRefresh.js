import { ref, watch } from 'vue'

// Exported so metrics.js's short-lived cache can use the exact same window
// — a value is "fresh" for as long as a refresh wouldn't have happened yet.
export const REFRESH_INTERVAL_MS = 30_000

// Shared across every CpuMonitor instance — one toggle, one timer, not
// per-component, so they all refresh in lockstep.
export const liveRefreshEnabled = ref(true)
export const refreshTick = ref(0)

// Backgrounding the tab (minimized, switched away from) pauses the timer —
// no point spending requests refreshing data nobody's looking at. Tracked
// separately from liveRefreshEnabled rather than toggling it, so a tab
// left with live refresh turned OFF doesn't silently turn back on just
// because the tab regained visibility.
const pageVisible = ref(document.visibilityState !== 'hidden')

let intervalId = null

function stopInterval() {
  if (!intervalId) return
  clearInterval(intervalId)
  intervalId = null
}

function startInterval() {
  if (intervalId) return
  intervalId = setInterval(() => {
    refreshTick.value++
  }, REFRESH_INTERVAL_MS)
}

function syncTimer() {
  if (liveRefreshEnabled.value && pageVisible.value) {
    startInterval()
  } else {
    stopInterval()
  }
}

watch(liveRefreshEnabled, syncTimer, { immediate: true })

document.addEventListener('visibilitychange', () => {
  const wasVisible = pageVisible.value
  pageVisible.value = document.visibilityState === 'visible'
  // Returning to the tab: refresh right away instead of leaving whatever
  // was on screen when it was last visible stale for up to a full
  // REFRESH_INTERVAL_MS after coming back.
  if (!wasVisible && pageVisible.value && liveRefreshEnabled.value) {
    refreshTick.value++
  }
  syncTimer()
})
