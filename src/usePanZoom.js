import { reactive } from 'vue'

const MIN_SCALE = 0.15
const MAX_SCALE = 3

export function usePanZoom(initial) {
  const view = reactive({ ...initial })
  let dragging = false
  let start = { x: 0, y: 0, panX: 0, panY: 0 }

  function clampScale(scale) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
  }

  function onWheel(e, viewportEl) {
    e.preventDefault()
    const rect = viewportEl.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const worldX = (mouseX - view.x) / view.scale
    const worldY = (mouseY - view.y) / view.scale
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const newScale = clampScale(view.scale * factor)
    view.x = mouseX - worldX * newScale
    view.y = mouseY - worldY * newScale
    view.scale = newScale
  }

  function onPointerDown(e) {
    dragging = true
    start = { x: e.clientX, y: e.clientY, panX: view.x, panY: view.y }
  }

  function onPointerMove(e) {
    if (!dragging) return
    view.x = start.panX + (e.clientX - start.x)
    view.y = start.panY + (e.clientY - start.y)
  }

  function onPointerUp() {
    dragging = false
  }

  function zoomBy(factor) {
    view.scale = clampScale(view.scale * factor)
  }

  function reset() {
    Object.assign(view, initial)
  }

  return {
    view,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    zoomBy,
    reset,
    isDragging: () => dragging,
  }
}
