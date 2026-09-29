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

// A coarse shared clock, so "how long since this reading arrived" can be a
// computed (see useMetric.js's isStale) instead of every badge on the map
// owning its own timer. One second is far finer than the staleness it's used
// to detect, and it only runs while live refresh does — when nothing is
// refreshing, nothing is going stale either.
const CLOCK_INTERVAL_MS = 1000
export const clockTick = ref(Date.now())

let intervalId = null
let clockId = null

function stopInterval() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  if (clockId) {
    clearInterval(clockId)
    clockId = null
  }
}

function startInterval() {
  if (!intervalId) {
    intervalId = setInterval(() => {
      refreshTick.value++
    }, REFRESH_INTERVAL_MS)
  }
  if (!clockId) {
    // Bumped immediately as well as on the interval, so a badge that was
    // already stale when live refresh got switched back on says so at once
    // rather than up to a second later.
    clockTick.value = Date.now()
    clockId = setInterval(() => {
      clockTick.value = Date.now()
    }, CLOCK_INTERVAL_MS)
  }
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
