<script setup>
// A vertical "rewind" control. Hovering, scrolling over it, or (on touch)
// dragging across it all just preview what past moment the cursor/finger
// is over, via rewind.js's global hoverPreviewTime; only a click or a
// plain tap commits to that moment, via rewind.js's global rewindTime —
// see metrics.js's fetchLatestMetric, which is what actually answers
// "what was this metric at that moment" from data already fetched for the
// live view (see main.py's WINDOW_SECONDS), no new network request per
// rewind point. "Now" is the top of the track, oldest (WINDOW_SECONDS ago)
// the bottom.
import { computed, ref } from 'vue'
import { rewindTime, hoverPreviewTime, effectiveRewindTime } from './rewind.js'

// Matches main.py's WINDOW_SECONDS — how far back the backend actually
// keeps data around for. Rewinding past this just clamps to the oldest
// point actually fetched (see metrics.js's pickAtTime) rather than
// silently doing nothing, but the track itself should reflect what's
// really available rather than implying a range that doesn't exist yet.
const WINDOW_SECONDS = 600
const TRACK_HEIGHT = 320 // px

const trackEl = ref(null)
const hoverY = ref(null) // px within the track, or null when not hovering

function clampY(y) {
  return Math.min(TRACK_HEIGHT, Math.max(0, y))
}

function timeAtY(y) {
  const frac = clampY(y) / TRACK_HEIGHT
  return new Date(Date.now() - frac * WINDOW_SECONDS * 1000)
}

// Updating hoverPreviewTime re-derives every metric badge on the whole map
// (see useMetric.js's watch on it) — doing that on literally every
// mousemove event (which can fire far faster than the data itself even
// changes resolution) would mean redundant work on every pixel of cursor
// travel. Trailing-edge throttled to at most once per THROTTLE_MS instead
// (a plain timer rather than requestAnimationFrame, which isn't reliably
// driven by anything for a single synthetic/scripted move that doesn't
// itself keep triggering new paints). The local hoverY/tooltip position
// still updates every event for a perfectly smooth cursor, since that's
// cheap, component-local state.
const THROTTLE_MS = 50
let lastPreviewAt = 0
let throttleTimeout = null

function scheduleHoverPreview(y) {
  const now = Date.now()
  const wait = THROTTLE_MS - (now - lastPreviewAt)
  if (wait <= 0) {
    lastPreviewAt = now
    hoverPreviewTime.value = timeAtY(y)
    return
  }
  if (throttleTimeout) return
  throttleTimeout = setTimeout(() => {
    throttleTimeout = null
    lastPreviewAt = Date.now()
    // hoverY may have moved on to null (mouse already left) by the time
    // this fires — leave hoverPreviewTime alone in that case; onLeave
    // already cleared it.
    if (hoverY.value !== null) hoverPreviewTime.value = timeAtY(hoverY.value)
  }, wait)
}

function onMove(e) {
  hoverY.value = clampY(e.clientY - trackEl.value.getBoundingClientRect().top)
  scheduleHoverPreview(hoverY.value)
}
function onLeave() {
  hoverY.value = null
  hoverPreviewTime.value = null
  if (throttleTimeout) {
    clearTimeout(throttleTimeout)
    throttleTimeout = null
  }
}
// Scrolling while over the track nudges the same temporary preview a
// mouse move would, rather than scrolling/panning the map underneath —
// stopped from propagating there for exactly that reason. Purely a
// hoverPreviewTime thing, same as a plain hover: it never touches the
// committed rewindTime, so scrolling alone still can't pause live refresh
// or otherwise commit to anything without an actual click.
function onWheel(e) {
  e.preventDefault()
  e.stopPropagation()
  hoverY.value = clampY((hoverY.value ?? 0) + e.deltaY)
  scheduleHoverPreview(hoverY.value)
}
// Snapped to "now" near the very top of the track, so a commit that's
// just a few pixels off the top reliably returns to live instead of
// rewinding by a handful of seconds nobody meant to ask for.
function commitAt(y) {
  rewindTime.value = y < 6 ? null : timeAtY(y)
}
function onClick() {
  if (hoverY.value === null) return
  commitAt(hoverY.value)
}
function backToLive() {
  rewindTime.value = null
}

// Touch has no hover at all, so it maps onto the same temporary-preview-
// vs-commit split differently than mouse does: dragging (moving enough
// from where the touch started) previews continuously exactly like a
// mouse hover, and lifting the finger afterwards just ends the preview —
// same as a mouse leaving the track — rather than committing to wherever
// it ends. Only a plain tap (touch down, then up, without dragging)
// commits, standing in for a mouse click.
const TOUCH_DRAG_THRESHOLD = 8 // px of movement before a touch counts as a drag, not a tap
let touchStartY = null
let touchDragged = false

function touchY(e) {
  const touch = e.touches[0] ?? e.changedTouches[0]
  return clampY(touch.clientY - trackEl.value.getBoundingClientRect().top)
}

function onTouchStart(e) {
  e.preventDefault()
  touchDragged = false
  touchStartY = touchY(e)
  hoverY.value = touchStartY
  hoverPreviewTime.value = timeAtY(touchStartY)
}
function onTouchMove(e) {
  e.preventDefault()
  const y = touchY(e)
  if (Math.abs(y - touchStartY) > TOUCH_DRAG_THRESHOLD) touchDragged = true
  hoverY.value = y
  scheduleHoverPreview(y)
}
function onTouchEnd(e) {
  e.preventDefault()
  if (!touchDragged && hoverY.value !== null) commitAt(hoverY.value)
  // Either way — a tap just committed, or a drag's preview is over — no
  // finger is touching the track anymore, so there's nothing left to
  // preview; the committed marker (if any) shows via rewindTime instead.
  hoverY.value = null
  hoverPreviewTime.value = null
  touchStartY = null
}

const hoverTime = computed(() => (hoverY.value !== null ? timeAtY(hoverY.value) : null))

// Where the currently-shown time (hover preview if active, else the
// committed rewind) sits on the track, as a % from the top — reused for
// both the marker and the "played" highlight below it, so both live-
// preview while hovering and then settle back to the committed point (or
// disappear entirely, if live) once the cursor leaves.
const activeFraction = computed(() =>
  effectiveRewindTime.value ? Math.min(1, (Date.now() - effectiveRewindTime.value.getTime()) / 1000 / WINDOW_SECONDS) : null
)

function formatRelative(date) {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000)
  if (seconds < 5) return 'now'
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.round(seconds / 60)}m ago`
}
function formatUtc(date) {
  // "14:32:07" from the ISO string, without pulling in a date library for
  // one fixed format.
  return date.toISOString().slice(11, 19) + ' UTC'
}

// One per minute, excluding the very first/last (0 and TRACK_HEIGHT) —
// those land right on the track's rounded end caps, where a straight tick
// mark just looks like it's colliding with the curve.
const TICK_COUNT = WINDOW_SECONDS / 60
const ticks = Array.from({ length: TICK_COUNT - 1 }, (_, i) => ((i + 1) / TICK_COUNT) * TRACK_HEIGHT)
</script>

<template>
  <div class="rewind-timeline">
    <button v-if="rewindTime" class="rewind-timeline__live-button" @click="backToLive">Back to live</button>

    <div class="rewind-timeline__status" :class="{ 'rewind-timeline__status--rewound': effectiveRewindTime }">
      <template v-if="effectiveRewindTime">{{ formatRelative(effectiveRewindTime) }}</template>
      <template v-else>live</template>
    </div>

    <div
      ref="trackEl"
      class="rewind-timeline__track"
      :style="{ height: TRACK_HEIGHT + 'px' }"
      @mousemove="onMove"
      @mouseleave="onLeave"
      @click="onClick"
      @wheel="onWheel"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <div v-if="activeFraction !== null" class="rewind-timeline__played" :style="{ height: activeFraction * TRACK_HEIGHT + 'px' }" />
      <div v-for="y in ticks" :key="y" class="rewind-timeline__tick" :style="{ top: y + 'px' }" />
      <div v-if="activeFraction !== null" class="rewind-timeline__marker" :style="{ top: activeFraction * TRACK_HEIGHT + 'px' }" />

      <div v-if="hoverTime" class="rewind-timeline__tooltip" :style="{ top: hoverY + 'px' }">
        <div>{{ hoverTime.toLocaleTimeString() }}</div>
        <div class="rewind-timeline__tooltip-secondary">{{ formatUtc(hoverTime) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rewind-timeline {
  position: fixed;
  z-index: 10;
  top: 50%;
  right: 1rem;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.rewind-timeline__status {
  /* Fixed width (fitting the longest realistic value, "10m ago") rather
     than shrink-to-fit — this sits above a track that's only 10px wide in
     a horizontally-centered flex column, so any width change as the text
     itself changes (e.g. "live" -> "5m ago") would shift the track a few
     pixels sideways too. Harmless for a real hovering mouse, which keeps
     tracking the element, but it raced a scripted/automated click's
     coordinates (computed once) right out from under it. */
  min-width: 3.5rem;
  text-align: center;
  font-size: 0.65rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.rewind-timeline__status--rewound {
  color: #b45309;
}

/* The interactive hit area is wider than the visible strip (its ::before
   below) — a 10px-wide target is uncomfortably narrow to hover/click
   precisely, but the track should still *look* like a slim timeline
   rather than a fat bar. Children (ticks/played/marker/tooltip) stay
   centered the same way regardless, since they position off this
   element's own width either way. */
.rewind-timeline__track {
  position: relative;
  width: 32px;
  cursor: pointer;
  /* Without this, a touch drag here also tries to scroll/pan the page
     underneath — same reasoning as .map-viewport's own touch-action:none. */
  touch-action: none;
}

.rewind-timeline__track::before {
  content: '';
  position: absolute;
  inset: 0;
  left: 50%;
  width: 10px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(6px);
  border: 1px solid #e2e8f0;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.12);
  pointer-events: none;
}

.rewind-timeline__played {
  position: absolute;
  top: 0;
  left: 50%;
  width: 10px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: #fde68a;
}

.rewind-timeline__tick {
  position: absolute;
  left: 50%;
  width: 4px;
  height: 1px;
  transform: translate(-50%, -0.5px);
  background: #94a3b8;
}

.rewind-timeline__marker {
  position: absolute;
  left: 50%;
  width: 16px;
  height: 16px;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: #b45309;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.3);
  pointer-events: none;
}

.rewind-timeline__tooltip {
  position: absolute;
  right: 100%;
  margin-right: 0.6rem;
  transform: translateY(-50%);
  background: rgba(15, 23, 42, 0.92);
  color: #f1f5f9;
  font-size: 0.65rem;
  line-height: 1.4;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  white-space: nowrap;
  pointer-events: none;
}

.rewind-timeline__tooltip-secondary {
  color: #94a3b8;
}

.rewind-timeline__live-button {
  font-size: 0.6rem;
  font-weight: 600;
  color: #92400e;
  background: #fef3c7;
  border: 1px solid #fde68a;
  border-radius: 999px;
  padding: 0.25rem 0.6rem;
  cursor: pointer;
}

.rewind-timeline__live-button:hover {
  background: #fde68a;
}
</style>
