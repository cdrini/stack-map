<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { spec, buildTree, buildEdges, metricsFor } from './spec.js'
import { partitionMetricFamilies, pendingRequestCount, pendingRequestTotal } from './metrics.js'
import { liveRefreshEnabled } from './liveRefresh.js'
import {
  computeMapLayout,
  computeFlatMapLayout,
  flattenLayout,
  flattenFlatLayout,
  rightSidePoints,
  leftSidePoints,
} from './mapLayout.js'
import { layoutExternals, EXTERNAL_ROW_GAP } from './externalLayout.js'
import { usePanZoom } from './usePanZoom.js'
import VmBox from './VmBox.vue'
import ExternalNode from './ExternalNode.vue'
import MetricBadge from './MetricBadge.vue'
import CpuBadge from './CpuBadge.vue'
import MemBadge from './MemBadge.vue'

const groupByServer = ref(false)
const tree = computed(() => buildTree())
const allVms = computed(() => tree.value.flatMap((server) => server.vms))

const isRefreshing = computed(() => pendingRequestCount.value > 0)

// A small ring drawn via stroke-dasharray/-dashoffset — the standard SVG
// circular-progress trick: a dash pattern exactly one circumference long,
// offset by the *uncompleted* fraction so what's left visible is the
// *completed* fraction, filling in clockwise from the top (rotate -90) as
// the current refresh's batched requests resolve.
const REFRESH_ARC_RADIUS = 6
const REFRESH_ARC_CIRCUMFERENCE = 2 * Math.PI * REFRESH_ARC_RADIUS
const refreshProgress = computed(() =>
  pendingRequestTotal.value > 0
    ? (pendingRequestTotal.value - pendingRequestCount.value) / pendingRequestTotal.value
    : 0
)

// Every VM's real size, measured from the DOM (see VmBox.vue's `measure()`)
// rather than predicted from constants — vm.id -> { width, height,
// containers: [{id,x,y,width,height}] }. Populated in two passes: once
// immediately on mount, from a hidden pool that renders every VM's
// "loading" state before anything is shown (so the very first layout
// doesn't have to block on every metric fetch completing); and again, per
// VM, once its badges' first real fetch has settled (see
// onFirstMetricsSettled) — correcting the pre-data guess if the box's
// actual content changed its shape, which today's fixed-height rows never
// do, but a richer future badge design might.
const measuredSizes = ref(new Map())
const initialSizesReady = ref(false)

const calibrationRefs = {}
function setCalibrationRef(vmId, el) {
  if (el) calibrationRefs[vmId] = el
  else delete calibrationRefs[vmId]
}

onMounted(async () => {
  await nextTick()
  const sizes = new Map()
  for (const vm of allVms.value) {
    const el = calibrationRefs[vm.id]
    if (el) sizes.set(vm.id, el.measure())
  }
  measuredSizes.value = sizes
  initialSizesReady.value = true
})

const realVmRefs = {}
function setRealVmRef(vmId, el) {
  if (el) realVmRefs[vmId] = el
  else delete realVmRefs[vmId]
}

const MEASUREMENT_EPSILON = 0.5 // px — ignore sub-pixel float noise between measurements
function nearlyEqual(a, b) {
  return Math.abs(a - b) < MEASUREMENT_EPSILON
}
function boxChanged(prev, next) {
  if (!prev) return true
  if (!nearlyEqual(prev.width, next.width) || !nearlyEqual(prev.height, next.height)) return true
  if (prev.containers.length !== next.containers.length) return true
  return prev.containers.some((c, i) => {
    const m = next.containers[i]
    return (
      !nearlyEqual(c.x, m.x) ||
      !nearlyEqual(c.y, m.y) ||
      !nearlyEqual(c.width, m.width) ||
      !nearlyEqual(c.height, m.height)
    )
  })
}

// Only re-measures and updates — never watches continuously (no
// ResizeObserver) — since a VM's row count is fixed by its spec-configured
// metrics, not by live data, so nothing should actually change here today;
// this just guards against a future badge design where it might.
function onFirstMetricsSettled(vmId) {
  const el = realVmRefs[vmId]
  if (!el) return
  const measurement = el.measure(view.scale)
  if (!boxChanged(measuredSizes.value.get(vmId), measurement)) return
  const sizes = new Map(measuredSizes.value)
  sizes.set(vmId, measurement)
  measuredSizes.value = sizes
}

// Grouping by server has no relationship-based ordering at all (VMs are
// grid-packed inside their server), so externals can't take part in a
// topology there — they get a fixed row above instead, and the rest of the
// map is shifted down to make room for it. The ungrouped layout has real
// topological positioning, so there externals are full graph participants
// (see computeFlatMapLayout) rather than a fixed decoration.
const externalLayout = computed(() => layoutExternals(spec.externals))
const externalShift = computed(() =>
  externalLayout.value.positions.length ? externalLayout.value.totalHeight + EXTERNAL_ROW_GAP : 0
)

const layout = computed(() => {
  if (!initialSizesReady.value) return null
  if (!groupByServer.value) return computeFlatMapLayout(tree.value, spec.externals, measuredSizes.value)

  const base = computeMapLayout(tree.value, measuredSizes.value)
  const shift = externalShift.value
  if (!shift) return base
  return {
    ...base,
    positions: base.positions.map((p) => ({ ...p, y: p.y + shift })),
    totalWidth: Math.max(base.totalWidth, externalLayout.value.totalWidth),
    totalHeight: base.totalHeight + shift,
  }
})

const renderedEdges = computed(() => {
  if (!layout.value) return []
  const boxes = groupByServer.value ? flattenLayout(layout.value) : flattenFlatLayout(layout.value)
  if (groupByServer.value) {
    for (const ep of externalLayout.value.positions) {
      boxes.set(ep.external.id, { x: ep.x, y: ep.y, width: ep.width, height: ep.height })
    }
  }
  const validEdges = []
  for (const edge of buildEdges()) {
    const fromBox = boxes.get(edge.from)
    const toBox = boxes.get(edge.to)
    if (!fromBox || !toBox) {
      console.warn(`stack-map: relationship references unknown id`, edge)
      continue
    }
    validEdges.push({ ...edge, fromBox, toBox })
  }

  // When several edges leave the same box's right side (one source with
  // multiple relationships) or arrive at the same box's left side (several
  // sources pointing at one target), fan them out along that side instead
  // of bunching them all at the midpoint — grouped separately per side,
  // since a box's outgoing and incoming counts are independent. Ordered by
  // the OTHER endpoint's vertical position so the fanned points line up
  // with what they connect to instead of crossing needlessly right at the
  // shared box.
  function groupEdgesBy(keyFn, sortKeyFn) {
    const groups = new Map()
    for (const edge of validEdges) {
      if (!groups.has(keyFn(edge))) groups.set(keyFn(edge), [])
      groups.get(keyFn(edge)).push(edge)
    }
    for (const group of groups.values()) group.sort((a, b) => sortKeyFn(a) - sortKeyFn(b))
    return groups
  }
  const fromGroups = groupEdgesBy(
    (e) => e.from,
    (e) => e.toBox.y
  )
  const toGroups = groupEdgesBy(
    (e) => e.to,
    (e) => e.fromBox.y
  )

  const edges = []
  for (const edge of validEdges) {
    const fromGroup = fromGroups.get(edge.from)
    const toGroup = toGroups.get(edge.to)
    const p1 = rightSidePoints(edge.fromBox, fromGroup.length)[fromGroup.indexOf(edge)]
    const p2 = leftSidePoints(edge.toBox, toGroup.length)[toGroup.indexOf(edge)]

    // Control points sit level with each endpoint (same y), so the curve
    // leaves the source heading straight right and arrives at the target
    // heading straight right too — matching the fixed left/right anchors
    // instead of cutting across them at an angle. The horizontal offset
    // scales with the distance between boxes (half the gap, floored) so
    // short hops curve gently and long ones don't end up razor-straight in
    // the middle before snapping sideways at the very ends.
    const MIN_CONTROL_OFFSET = 30
    const controlOffset = Math.max(MIN_CONTROL_OFFSET, Math.abs(p2.x - p1.x) / 2)
    const c1 = { x: p1.x + controlOffset, y: p1.y }
    const c2 = { x: p2.x - controlOffset, y: p2.y }

    // Midpoint of the cubic bezier at t=0.5, not the straight-line
    // midpoint — for a curve with a lot of vertical travel those two can
    // be far apart, leaving the label floating off to the side of the line
    // it's meant to caption.
    const labelX = (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8
    const labelY = (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8

    edges.push({
      id: `${edge.from}=>${edge.to}`,
      path: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`,
      labelX,
      labelY,
      label: edge.label,
    })
  }
  return edges
})

const viewportEl = ref(null)
const { view, onWheel, onPointerDown, onPointerMove, onPointerUp, zoomBy, reset } = usePanZoom({
  x: 24,
  y: 24,
  scale: 0.85,
})
</script>

<template>
  <div class="map-view">
    <div class="map-toolbar">
      <button @click="zoomBy(1.25)">+</button>
      <button @click="zoomBy(1 / 1.25)">&minus;</button>
      <button @click="reset()">Reset view</button>
      <span class="map-toolbar__readout">{{ Math.round(view.scale * 100) }}%</span>
      <label class="map-toolbar__toggle">
        <input type="checkbox" v-model="groupByServer" />
        Group by server
      </label>
      <label class="map-toolbar__toggle">
        <input type="checkbox" v-model="liveRefreshEnabled" />
        Live refresh (30s)
        <svg
          v-if="isRefreshing"
          class="map-toolbar__refresh-arc"
          viewBox="0 0 16 16"
          width="15"
          height="15"
          :title="`fetching updated metrics… (${pendingRequestTotal - pendingRequestCount}/${pendingRequestTotal})`"
        >
          <circle class="map-toolbar__refresh-arc-track" cx="8" cy="8" :r="REFRESH_ARC_RADIUS" fill="none" stroke-width="3" />
          <circle
            class="map-toolbar__refresh-arc-fill"
            cx="8"
            cy="8"
            :r="REFRESH_ARC_RADIUS"
            fill="none"
            stroke-width="3"
            stroke-linecap="round"
            :stroke-dasharray="REFRESH_ARC_CIRCUMFERENCE"
            :stroke-dashoffset="REFRESH_ARC_CIRCUMFERENCE * (1 - refreshProgress)"
            transform="rotate(-90 8 8)"
          />
        </svg>
      </label>
      <span class="map-toolbar__hint">scroll to zoom, drag to pan</span>
    </div>

    <div
      class="map-viewport"
      ref="viewportEl"
      @wheel="onWheel($event, viewportEl)"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
    >
      <div
        class="map-grid"
        :style="{
          backgroundPosition: `${view.x}px ${view.y}px`,
          backgroundSize: `${20 * view.scale}px ${20 * view.scale}px`,
        }"
      ></div>

      <div v-if="!layout" class="map-measuring-hint">Measuring layout&hellip;</div>

      <div
        v-else
        class="map-world"
        :style="{
          width: layout.totalWidth + 'px',
          height: layout.totalHeight + 'px',
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }"
      >
        <template v-if="groupByServer">
          <ExternalNode
            v-for="ep in externalLayout.positions"
            :key="ep.external.id"
            :external="ep.external"
            :x="ep.x"
            :y="ep.y"
            :width="ep.width"
            :height="ep.height"
          />
          <div
            v-for="s in layout.positions"
            :key="s.server.id"
            class="map-server"
            :style="{ left: s.x + 'px', top: s.y + 'px', width: s.width + 'px', height: s.height + 'px' }"
          >
            <div class="map-server__label">
              <span class="map-server__icon">&#9639;</span>
              {{ s.server.id }}
              <CpuBadge
                v-if="partitionMetricFamilies(metricsFor(s.server, 'server')).cpuMetrics.length"
                :metrics="partitionMetricFamilies(metricsFor(s.server, 'server')).cpuMetrics"
                :resource-id="s.server.id"
              />
              <MemBadge
                v-if="partitionMetricFamilies(metricsFor(s.server, 'server')).ramMetrics.length"
                :metrics="partitionMetricFamilies(metricsFor(s.server, 'server')).ramMetrics"
                :resource-id="s.server.id"
              />
              <MetricBadge
                v-for="metric in partitionMetricFamilies(metricsFor(s.server, 'server')).otherMetrics"
                :key="metric.type"
                :metric="metric"
                :resource-id="s.server.id"
              />
            </div>

            <VmBox
              v-for="vp in s.vmPositions"
              :key="vp.vm.id"
              :vm="vp.vm"
              :x="vp.x"
              :y="vp.y"
              :ref="(el) => setRealVmRef(vp.vm.id, el)"
              @first-metrics-settled="onFirstMetricsSettled"
            />
          </div>
        </template>

        <template v-else>
          <div
            v-if="layout.hasUnconnected && layout.topoHeight > 0"
            class="map-section-label"
            :style="{ top: layout.topoHeight + 8 + 'px' }"
          >
            no direct relationships
          </div>
          <template v-for="node in layout.positions" :key="node.id">
            <VmBox
              v-if="node.kind === 'vm'"
              :vm="node.vm"
              :x="node.x"
              :y="node.y"
              :ref="(el) => setRealVmRef(node.vm.id, el)"
              @first-metrics-settled="onFirstMetricsSettled"
            />
            <ExternalNode
              v-else
              :external="node.external"
              :x="node.x"
              :y="node.y"
              :width="node.width"
              :height="node.height"
            />
          </template>
        </template>

        <svg class="map-edges" :width="layout.totalWidth" :height="layout.totalHeight">
          <defs>
            <marker
              id="map-edge-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#64748b" />
            </marker>
          </defs>
          <g v-for="edge in renderedEdges" :key="edge.id">
            <path
              :d="edge.path"
              fill="none"
              stroke="#64748b"
              stroke-width="1.5"
              marker-end="url(#map-edge-arrow)"
            />
            <text v-if="edge.label" :x="edge.labelX" :y="edge.labelY" class="map-edge__label">
              {{ edge.label }}
            </text>
          </g>
        </svg>
      </div>
    </div>

    <!-- Renders every VM's real markup off-screen, unconstrained, purely to
         read its natural size before the first real layout is computed —
         see measuredSizes above. Torn down once that's done; it's not kept
         around as a permanently-hidden duplicate of the real map. -->
    <div v-if="!initialSizesReady" class="map-calibration-pool" aria-hidden="true">
      <VmBox v-for="vm in allVms" :key="vm.id" :vm="vm" :ref="(el) => setCalibrationRef(vm.id, el)" />
    </div>
  </div>
</template>

<style scoped>
.map-view {
  display: flex;
  flex-direction: column;
  height: calc(100svh - 6.5rem);
  padding: 0 1.5rem 1.5rem;
}

.map-measuring-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #94a3b8;
  font-size: 0.85rem;
}

/* Off-screen and non-interactive, but NOT display:none — it needs to stay
   in the layout tree for VmBox.vue's measure() to read real geometry from
   it. Clipped to zero size so it can't affect page scroll bounds. */
.map-calibration-pool {
  position: fixed;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  overflow: hidden;
  visibility: hidden;
  pointer-events: none;
}

.map-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-bottom: 0.75rem;
}

.map-toolbar button {
  font-size: 0.85rem;
  padding: 0.3rem 0.7rem;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #0f172a;
  border-radius: 6px;
  cursor: pointer;
}

.map-toolbar button:hover {
  background: #f1f5f9;
}

.map-toolbar__readout {
  font-size: 0.8rem;
  color: #64748b;
  min-width: 3.5rem;
}

.map-toolbar__toggle {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.85rem;
  color: #334155;
  cursor: pointer;
}

.map-toolbar__refresh-arc-track {
  stroke: #dbeafe;
}

.map-toolbar__refresh-arc-fill {
  stroke: #2563eb;
  /* Smooths each step as individual requests resolve, rather than the
     ring visibly jumping forward in a handful of discrete increments. */
  transition: stroke-dashoffset 0.2s linear;
}

.map-toolbar__hint {
  font-size: 0.78rem;
  color: #94a3b8;
  margin-left: auto;
}

.map-viewport {
  position: relative;
  flex: 1;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background-color: #cbd5e1;
  cursor: grab;
  touch-action: none;
}

.map-viewport:active {
  cursor: grabbing;
}

.map-world {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}

/* Covers the whole viewport (not just .map-world's finite totalWidth x
   totalHeight box) so the dots never "run out" while panning — CSS wraps
   background-position/-size using modulo the tile size automatically, so
   driving both from the same view.x/y/scale used for .map-world's
   transform keeps the dots anchored to world-space without needing an
   actually-infinite element. */
.map-grid {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(#94a3b8 1px, transparent 1px);
  pointer-events: none;
}

.map-edges {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
  pointer-events: none;
}

.map-edge__label {
  font-size: 9px;
  fill: #334155;
  stroke: #f8fafc;
  stroke-width: 3px;
  paint-order: stroke;
  text-anchor: middle;
  dominant-baseline: middle;
}

.map-server {
  position: absolute;
  background: #eef2f7;
  border: 1.5px solid #94a3b8;
  border-radius: 10px;
  box-sizing: border-box;
}

.map-server__label {
  position: absolute;
  top: 8px;
  left: 12px;
  font-weight: 600;
  font-size: 0.85rem;
  color: #0f172a;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.map-server__icon {
  color: #94a3b8;
}

.map-section-label {
  position: absolute;
  left: 0;
  font-size: 0.7rem;
  color: #94a3b8;
  font-style: italic;
}
</style>
