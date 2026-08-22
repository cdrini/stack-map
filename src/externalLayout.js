// Layout for `externals` — actors outside the stack (e.g. "live traffic")
// that point into it. Kept separate from mapLayout.js's server/VM/container
// packing since externals aren't part of that tree at all; they're placed
// in their own row above it.

export const EXTERNAL_NODE_WIDTH = 120
export const EXTERNAL_NODE_HEIGHT = 48
export const EXTERNAL_GAP = 16
export const EXTERNAL_ROW_GAP = 32

export function layoutExternals(externals) {
  const positions = []
  let x = 0
  for (const external of externals) {
    positions.push({ external, x, y: 0, width: EXTERNAL_NODE_WIDTH, height: EXTERNAL_NODE_HEIGHT })
    x += EXTERNAL_NODE_WIDTH + EXTERNAL_GAP
  }
  const totalWidth = Math.max(0, x - EXTERNAL_GAP)
  const totalHeight = externals.length ? EXTERNAL_NODE_HEIGHT : 0
  return { positions, totalWidth, totalHeight }
}
