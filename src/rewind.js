import { computed, ref, watch } from 'vue'
import { liveRefreshEnabled } from './liveRefresh.js'

// null = live ("now"); a Date = viewing the map as of that past moment.
// The *committed* rewind point — only ever changes on an actual click or
// tap in RewindTimeline.vue, not while just hovering/dragging it (see
// hoverPreviewTime).
export const rewindTime = ref(null)

// A temporary rewind while the cursor is over the timeline (or, on touch,
// while a finger is dragging across it), previewing what committing there
// would show without actually doing so — cleared back to null once that
// stops, reverting to whatever rewindTime already was (live, or a
// previously committed point).
export const hoverPreviewTime = ref(null)

// What every metric fetch should actually treat as "now" — the hover
// preview whenever it's active (so dragging the cursor along the timeline
// live-previews without a click), otherwise the committed rewindTime, or
// true live if neither is set. Global rather than per-badge for the same
// reason liveRefreshEnabled is — one shared state every metric fetch
// checks, not something each badge tracks independently. See metrics.js's
// fetchLatestMetric, which is the one place this actually gets applied
// (picking from a metric's already-fetched window instead of its latest
// point) — every composite family (CpuBadge, MemBadge, ...) calls that
// under the hood, so none of them need their own rewind awareness.
export const effectiveRewindTime = computed(() => hoverPreviewTime.value ?? rewindTime.value)

// Rewinding views a fixed past moment — auto-refreshing every 30s while
// looking at one would just as auto-magically un-rewind back to "now" a
// half-minute later, which isn't what clicking a point in the past means.
// Returning to live (rewindTime back to null) resumes it, on the
// assumption that if you bothered to snap back to "now" you want it live
// again — overrides a manual "Live refresh" off from before the rewind,
// but that's an edge case rare enough not to warrant remembering it
// separately.
watch(rewindTime, (time) => {
  liveRefreshEnabled.value = time === null
})
