import { reactive, ref } from 'vue'

const MIN_SCALE = 0.15
const MAX_SCALE = 3

export function usePanZoom(initial) {
  const view = reactive({ ...initial })
  // A ref (not a plain closure variable) so the template can react to
  // it directly — see MapView.vue's use of it to suspend text selection
  // only while an actual drag is in progress, rather than disabling
  // selection on the map wholesale.
  const dragging = ref(false)
  let start = { x: 0, y: 0, panX: 0, panY: 0 }

  // Active pointers currently down, keyed by pointerId. A second
  // simultaneous pointer means a pinch gesture rather than a pan — tracked
  // here rather than via separate touch-event handlers since panning
  // already runs on Pointer Events, which report touches too.
  const pointers = new Map()
  // Set while exactly two pointers are down: the gesture's anchor state,
  // so each move computes scale/position fresh from the start of the
  // pinch rather than drifting frame-to-frame.
  let pinch = null

  function clampScale(scale) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
  }

  function zoomAt(x, y, newScale) {
    const worldX = (x - view.x) / view.scale
    const worldY = (y - view.y) / view.scale
    view.x = x - worldX * newScale
    view.y = y - worldY * newScale
    view.scale = newScale
  }

  function onWheel(e, viewportEl) {
    e.preventDefault()

    // Trackpad pinch gestures are reported as wheel events with ctrlKey
    // set — even though no key is actually held — the standard
    // cross-browser signal apps like Google Maps/Figma use to tell a pinch
    // apart from a plain scroll; a physical Ctrl+wheel reads the same way,
    // which is the convention those apps use for mouse users too. Its
    // deltaY varies continuously with gesture speed rather than arriving
    // in fixed notches, so it's scaled exponentially (and clamped) instead
    // of by a flat per-event factor.
    if (e.ctrlKey) {
      const rect = viewportEl.getBoundingClientRect()
      const factor = Math.exp(-Math.max(-50, Math.min(50, e.deltaY)) * 0.01)
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, clampScale(view.scale * factor))
      return
    }

    // Anything else — mouse wheel or trackpad two-finger scroll — pans.
    // Trying to also guess trackpad-vs-mouse from delta shape (fractional/
    // diagonal vs "clean" integer steps) to zoom on a plain mouse wheel
    // was too unreliable in practice.
    view.x -= e.deltaX
    view.y -= e.deltaY
  }

  function pinchGeometry(rect) {
    const [a, b] = [...pointers.values()]
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      midX: (a.x + b.x) / 2 - rect.left,
      midY: (a.y + b.y) / 2 - rect.top,
    }
  }

  function onPointerDown(e) {
    // No pointer capture here — see onPointerMove, which captures lazily
    // on the first actual move instead.
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.size === 2) {
      dragging.value = false
      const { distance, midX, midY } = pinchGeometry(e.currentTarget.getBoundingClientRect())
      pinch = { startDistance: distance, startScale: view.scale, startPan: { x: view.x, y: view.y }, startMidX: midX, startMidY: midY }
    } else if (pointers.size === 1) {
      dragging.value = true
      start = { x: e.clientX, y: e.clientY, panX: view.x, panY: view.y }
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return

    // Captured lazily here, on the first real move, rather than on
    // pointerdown — a plain click never generates a move at all, so this
    // leaves a click straight through to whatever's underneath (capturing
    // on every pointerdown redirected the resulting click event's target
    // to the viewport itself instead, breaking click-to-open on the
    // CPU/RAM/disk badges nested inside it). Once an actual drag/pinch is
    // happening, capturing here keeps events coming regardless of the
    // cursor crossing an overlapping HUD panel, leaving the viewport's
    // bounds, or leaving the browser window entirely.
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.setPointerCapture(e.pointerId)
    }

    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.size === 2 && pinch) {
      const rect = e.currentTarget.getBoundingClientRect()
      const { distance, midX, midY } = pinchGeometry(rect)
      const newScale = clampScale(pinch.startScale * (distance / pinch.startDistance))
      // The world point that sat under the fingers' midpoint when the
      // pinch began should stay under their (possibly drifted) midpoint
      // now — same anchor-preserving math as zoomAt, but against the
      // pinch's fixed starting view rather than the live one.
      const worldX = (pinch.startMidX - pinch.startPan.x) / pinch.startScale
      const worldY = (pinch.startMidY - pinch.startPan.y) / pinch.startScale
      view.x = midX - worldX * newScale
      view.y = midY - worldY * newScale
      view.scale = newScale
      return
    }

    if (!dragging.value) return
    view.x = start.panX + (e.clientX - start.x)
    view.y = start.panY + (e.clientY - start.y)
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId)

    if (pointers.size === 1) {
      // Drop from pinch back to a single finger — resume panning from
      // its current position rather than the pinch's stale start point,
      // so the map doesn't jump.
      const [remaining] = pointers.values()
      start = { x: remaining.x, y: remaining.y, panX: view.x, panY: view.y }
      dragging.value = true
      pinch = null
    } else if (pointers.size === 0) {
      dragging.value = false
      pinch = null
    }
  }

  function zoomBy(factor) {
    view.scale = clampScale(view.scale * factor)
  }

  function reset() {
    Object.assign(view, initial)
  }

  return {
    view,
    dragging,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    zoomBy,
    reset,
  }
}
