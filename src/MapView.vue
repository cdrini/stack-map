<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { spec, buildTree, buildEdges, metricsFor } from './spec.js'
import { partitionMetricFamilies, pendingRequestCount, pendingRequestTotal, clearResultCache } from './metrics.js'
import { liveRefreshEnabled, refreshTick } from './liveRefresh.js'
import {
  computeMapLayout,
  computeFlatMapLayout,
  computeContainerMapLayout,
  flattenLayout,
  flattenFlatLayout,
  rightSidePoints,
  leftSidePoints,
} from './mapLayout.js'
import { layoutExternals, EXTERNAL_ROW_GAP } from './externalLayout.js'
import { usePanZoom } from './usePanZoom.js'
import UButton from '@nuxt/ui/components/Button.vue'
import UCheckbox from '@nuxt/ui/components/Checkbox.vue'
import USelect from '@nuxt/ui/components/Select.vue'
import VmBox from './VmBox.vue'
import ExternalNode from './ExternalNode.vue'
import ContainerNode from './ContainerNode.vue'
import MetricBadge from './MetricBadge.vue'
import CpuBadge from './CpuBadge.vue'
import MemBadge from './MemBadge.vue'

// Was a prop from App.vue back when the toggle lived in a separate page
// header — now that all controls float directly on the map itself, it's
// just local state like everything else here.
const hoverDimEnabled = ref(true)

const groupByServer = ref(false)
// Which algorithm "Group by server" uses to arrange servers among
// themselves and units within each one — see mapLayout.js's computeMapLayout.
const serverLayoutAlgorithm = ref('topo')
// Unchecking this swaps in the same topological algorithm as the default
// (ungrouped) view, but with containers themselves as the positioned
// nodes instead of the VMs hosting them — see mapLayout.js's
// computeContainerMapLayout/computeMapLayout's `granularity`. True
// (containers nested in their VM's box, same as today) is the default so
// the map's normal look is opt-out, not opt-in. Orthogonal to
// groupByServer — either can be on independently, giving four combinations
// (ungrouped/grouped × VM/container granularity).
const groupByVm = ref(true)
const layoutMode = computed(() => {
  if (groupByServer.value) return 'server'
  return groupByVm.value ? 'flat' : 'container'
})

const tree = computed(() => buildTree())
const allVms = computed(() => tree.value.flatMap((server) => server.vms))
const allContainers = computed(() => spec.containers)

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

// Cache eviction is what makes this an actual forced refresh rather than a
// no-op — a plain refreshTick bump alone would just re-trigger `load()`
// calls that immediately resolve from whatever's still within the normal
// 30s window.
function forceRefresh() {
  clearResultCache()
  refreshTick.value++
}

// Every VM's real size, measured from the DOM (see VmBox.vue's `measure()`)
// rather than predicted from constants — vm.id -> { width, height,
// containers: [{id,x,y,width,height}] }. Populated in an initial pass on
// mount, from a hidden pool that renders every VM's "loading" state before
// anything is shown (so the very first layout doesn't have to block on
// every metric fetch completing); then corrected on demand whenever a VM
// reports its size may have changed (see onRecheckSize) — its badges'
// first real fetch settling in, or (for solr's per-handler rows, which can
// come and go based on live traffic) a row appearing/disappearing on any
// later refresh too.
const measuredSizes = ref(new Map())
// Same idea, one level down — a container's own natural size, only
// meaningful in layoutMode 'container' (see ContainerNode.vue's own
// measure()). Measured alongside VM sizes in the same calibration pass
// below rather than lazily on first toggle, so switching into container
// mode later never has to show a "measuring…" flash of its own.
const measuredContainerSizes = ref(new Map())
const initialSizesReady = ref(false)

const calibrationRefs = {}
function setCalibrationRef(vmId, el) {
  if (el) calibrationRefs[vmId] = el
  else delete calibrationRefs[vmId]
}

const containerCalibrationRefs = {}
function setContainerCalibrationRef(containerId, el) {
  if (el) containerCalibrationRefs[containerId] = el
  else delete containerCalibrationRefs[containerId]
}

onMounted(async () => {
  await nextTick()
  const sizes = new Map()
  for (const vm of allVms.value) {
    const el = calibrationRefs[vm.id]
    if (el) sizes.set(vm.id, el.measure())
  }
  measuredSizes.value = sizes

  const containerSizes = new Map()
  for (const c of allContainers.value) {
    const el = containerCalibrationRefs[c.id]
    if (el) containerSizes.set(c.id, el.measure())
  }
  measuredContainerSizes.value = containerSizes

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

// Re-measures and updates only when told to (no continuous ResizeObserver)
// — VmBox.vue calls this out specifically: once when a box's badges first
// settle, and again any time a solr handler row's empty/non-empty status
// actually flips afterward, since that's the one thing here whose row
// count depends on live data rather than static spec config.
function onRecheckSize(vmId) {
  const el = realVmRefs[vmId]
  if (!el) return
  const measurement = el.measure(view.scale)
  if (!boxChanged(measuredSizes.value.get(vmId), measurement)) return
  const sizes = new Map(measuredSizes.value)
  sizes.set(vmId, measurement)
  measuredSizes.value = sizes
}

const realContainerRefs = {}
function setRealContainerRef(containerId, el) {
  if (el) realContainerRefs[containerId] = el
  else delete realContainerRefs[containerId]
}

// Same as onRecheckSize, but for a standalone ContainerNode in layoutMode
// 'container' — no nested containers of its own to diff, so the box-changed
// check is just its own width/height.
function onRecheckSizeContainer(containerId) {
  const el = realContainerRefs[containerId]
  if (!el) return
  const measurement = el.measure(view.scale)
  const prev = measuredContainerSizes.value.get(containerId)
  if (prev && nearlyEqual(prev.width, measurement.width) && nearlyEqual(prev.height, measurement.height)) return
  const sizes = new Map(measuredContainerSizes.value)
  sizes.set(containerId, measurement)
  measuredContainerSizes.value = sizes
}

// Grouping by server positions VMs topologically within their own server's
// box (see mapLayout.js's layoutServer), but that's scoped to one server at
// a time — an external isn't hosted on any single server, so it can't be a
// participant in any one server's sub-layout. It gets a fixed row above
// instead, and the rest of the map is shifted down to make room for it.
// The ungrouped layout has no such scoping issue, so there externals are
// full graph participants (see computeFlatMapLayout) rather than a fixed
// decoration.
const externalLayout = computed(() => layoutExternals(spec.externals))
const externalShift = computed(() =>
  externalLayout.value.positions.length ? externalLayout.value.totalHeight + EXTERNAL_ROW_GAP : 0
)

const layout = computed(() => {
  if (!initialSizesReady.value) return null
  if (layoutMode.value === 'container') {
    return computeContainerMapLayout(allContainers.value, spec.externals, measuredContainerSizes.value)
  }
  if (layoutMode.value === 'flat') return computeFlatMapLayout(tree.value, spec.externals, measuredSizes.value)

  const granularity = groupByVm.value ? 'vm' : 'container'
  const sizes = groupByVm.value ? measuredSizes.value : measuredContainerSizes.value
  const base = computeMapLayout(tree.value, sizes, serverLayoutAlgorithm.value, granularity)
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
  const boxes = layoutMode.value === 'server' ? flattenLayout(layout.value) : flattenFlatLayout(layout.value)
  if (layoutMode.value === 'server') {
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
      from: edge.from,
      to: edge.to,
      path: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`,
      labelX,
      labelY,
      label: edge.label,
    })
  }
  return edges
})

// Set by a VmBox's container chip on hover (see its @hover-container),
// cleared on mouseleave — read directly in the template rather than folded
// into renderedEdges, so hovering doesn't force the edges' geometry
// (fanning, bezier curves) to recompute on every mouse move.
const hoveredContainerId = ref(null)
function setHoveredContainer(id) {
  // Ignored (rather than gating every consumer of hoveredContainerId
  // individually) when the toggle is off, so it just never gets set in
  // the first place — nothing downstream needs its own awareness of the
  // setting.
  hoveredContainerId.value = hoverDimEnabled.value ? id : null
}
// Also clears immediately if the toggle is switched off mid-hover, rather
// than waiting for the next mouseleave/mouseenter to notice.
watch(hoverDimEnabled, (enabled) => {
  if (!enabled) hoveredContainerId.value = null
})

// The hovered container plus everything it has a direct relationship
// with (either direction) — null when nothing's hovered, meaning "don't
// dim anything". Passed down to every VmBox so it can dim its own
// containers that aren't in this set; kept separate from renderedEdges
// for the same reason as hoveredContainerId itself (buildEdges() here is
// just a cheap raw scan, not the fanned/curved geometry).
const attachedContainerIds = computed(() => {
  if (!hoveredContainerId.value) return null
  const ids = new Set([hoveredContainerId.value])
  for (const edge of buildEdges()) {
    if (edge.from === hoveredContainerId.value) ids.add(edge.to)
    if (edge.to === hoveredContainerId.value) ids.add(edge.from)
  }
  return ids
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
    <!-- Data freshness: is it live, and how live. -->
    <div class="map-hud map-hud--top-right">
      <UCheckbox v-model="liveRefreshEnabled" label="Live refresh (30s)" />
      <UButton
        v-if="!isRefreshing"
        size="sm"
        color="neutral"
        variant="outline"
        square
        icon="i-lucide-rotate-ccw"
        aria-label="Force refresh"
        title="Force refresh (bypasses the cache)"
        @click="forceRefresh"
      />
      <svg
        v-else
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
    </div>

    <!-- Structure (what the map is organized by/around) and navigation
         (zoom/pan, dim-on-hover) share one bottom-center toolbar — neither
         is tied to a particular screen edge the way the HUD panels above
         are, so there's no "grows out of the edge" side for either. -->
    <div class="map-hud-bottom-dock">
    <div class="map-hud map-hud--bottom-center">
      <UCheckbox v-model="groupByServer" label="Group by server" />
      <USelect
        v-if="groupByServer"
        v-model="serverLayoutAlgorithm"
        size="sm"
        :items="[
          { label: 'Topological', value: 'topo' },
          { label: 'Grid', value: 'grid' },
        ]"
        title="How 'Group by server' arranges servers among themselves and units within each one"
      />
      <UCheckbox
        v-model="groupByVm"
        label="Group by VM"
        title="Unchecking positions containers themselves via the same topological algorithm, instead of nesting them in their VM's box"
      />

      <div class="map-hud__divider" />

      <UButton
        size="sm"
        color="neutral"
        variant="outline"
        square
        icon="i-lucide-minus"
        aria-label="Zoom out"
        @click="zoomBy(1 / 1.25)"
      />
      <span class="map-toolbar__readout">{{ Math.round(view.scale * 100) }}%</span>
      <UButton
        size="sm"
        color="neutral"
        variant="outline"
        square
        icon="i-lucide-plus"
        aria-label="Zoom in"
        @click="zoomBy(1.25)"
      />
      <UButton size="sm" color="neutral" variant="outline" @click="reset()">Reset view</UButton>

      <div class="map-hud__divider" />

      <UCheckbox v-model="hoverDimEnabled" label="Dim unrelated on hover" />
    </div>
    </div>

    <div
      class="map-viewport"
      ref="viewportEl"
      @wheel="onWheel($event, viewportEl)"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
      @pointercancel="onPointerUp"
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
        <template v-if="layoutMode === 'server'">
          <ExternalNode
            v-for="ep in externalLayout.positions"
            :key="ep.external.id"
            :external="ep.external"
            :x="ep.x"
            :y="ep.y"
            :width="ep.width"
            :height="ep.height"
            :attached-container-ids="attachedContainerIds"
            @hover-container="setHoveredContainer"
          />
          <div
            v-if="layout.hasUnconnected && layout.topoHeight > 0"
            class="map-section-label"
            :style="{ top: layout.topoHeight + externalShift + 8 + 'px' }"
          >
            no direct relationships
          </div>
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

            <template v-for="up in s.unitPositions" :key="up.id">
              <VmBox
                v-if="up.kind === 'vm'"
                :vm="up.vm"
                :x="up.x"
                :y="up.y"
                :ref="(el) => setRealVmRef(up.id, el)"
                :attached-container-ids="attachedContainerIds"
                @recheck-size="onRecheckSize"
                @hover-container="setHoveredContainer"
              />
              <ContainerNode
                v-else
                :container="up.container"
                :x="up.x"
                :y="up.y"
                :ref="(el) => setRealContainerRef(up.id, el)"
                :attached-container-ids="attachedContainerIds"
                @recheck-size="onRecheckSizeContainer"
                @hover-container="setHoveredContainer"
              />
            </template>
          </div>
        </template>

        <template v-else-if="layoutMode === 'container'">
          <div
            v-if="layout.hasUnconnected && layout.topoHeight > 0"
            class="map-section-label"
            :style="{ top: layout.topoHeight + 8 + 'px' }"
          >
            no direct relationships
          </div>
          <template v-for="node in layout.positions" :key="node.id">
            <ContainerNode
              v-if="node.kind === 'container'"
              :container="node.container"
              :x="node.x"
              :y="node.y"
              :ref="(el) => setRealContainerRef(node.container.id, el)"
              :attached-container-ids="attachedContainerIds"
              @recheck-size="onRecheckSizeContainer"
              @hover-container="setHoveredContainer"
            />
            <ExternalNode
              v-else
              :external="node.external"
              :x="node.x"
              :y="node.y"
              :width="node.width"
              :height="node.height"
              :attached-container-ids="attachedContainerIds"
              @hover-container="setHoveredContainer"
            />
          </template>
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
              :attached-container-ids="attachedContainerIds"
              @recheck-size="onRecheckSize"
              @hover-container="setHoveredContainer"
            />
            <ExternalNode
              v-else
              :external="node.external"
              :x="node.x"
              :y="node.y"
              :width="node.width"
              :height="node.height"
              :attached-container-ids="attachedContainerIds"
              @hover-container="setHoveredContainer"
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
          <g
            v-for="edge in renderedEdges"
            :key="edge.id"
            class="map-edge"
            :class="{
              'map-edge--dimmed':
                hoveredContainerId && edge.from !== hoveredContainerId && edge.to !== hoveredContainerId,
            }"
          >
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

    <!-- Renders every VM's (and, for the "Group by VM" toggle unchecked,
         every container's own standalone) real markup off-screen, unconstrained,
         purely to read its natural size before the first real layout is
         computed — see measuredSizes/measuredContainerSizes above. Torn
         down once that's done; it's not kept around as a
         permanently-hidden duplicate of the real map. -->
    <div v-if="!initialSizesReady" class="map-calibration-pool" aria-hidden="true">
      <VmBox v-for="vm in allVms" :key="vm.id" :vm="vm" :ref="(el) => setCalibrationRef(vm.id, el)" />
      <ContainerNode
        v-for="c in allContainers"
        :key="c.id"
        :container="c"
        :ref="(el) => setContainerCalibrationRef(c.id, el)"
      />
    </div>
  </div>
</template>

<style scoped>
/* Fills the whole viewport — every control floats on top of the map
   itself (see .map-hud below) rather than living in a page header, so
   there's no separate layout region to reserve space for. */
.map-view {
  position: fixed;
  inset: 0;
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

/* A floating HUD panel over the map — see the three usages above (bottom
   left: structure, top right: data freshness, bottom right: navigation)
   for what lives where and why. Always one row (never wraps to a second
   line), flush against whichever screen edge it's anchored to (no gap,
   square corners on that side) so it reads as a tab growing out of the
   edge rather than a card floating independently — the opposite end is
   fully rounded instead. Plain CSS rather than a UCard: this is just a
   small, fully custom panel shape, not worth pulling in a whole
   component's theme surface for. */
.map-hud {
  position: absolute;
  z-index: 10;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 0.6rem;
  background: repeating-linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.72) 0px,
    rgba(255, 255, 255, 0.72) 14px,
    rgba(255, 255, 255, 0.62) 22px,
    rgba(255, 255, 255, 0.48) 30px,
    rgba(255, 255, 255, 0.48) 38px,
    rgba(255, 255, 255, 0.62) 46px,
    rgba(255, 255, 255, 0.72) 54px
  );
  backdrop-filter: blur(14px) saturate(1.6);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow:
    0 2px 8px rgba(15, 23, 42, 0.12),
    inset 1px 1px 0 rgba(255, 255, 255, 0.8);
  padding: 0.6rem 0.9rem;
}

/* Floats free of the edge, same as .map-hud--bottom-center — fully
   rounded on all sides rather than growing out of the right edge. */
.map-hud--top-right {
  top: 1rem;
  right: 1rem;
  border-radius: 999px;
  padding: 2px 8px;
}

/* Positions the bottom-center toolbar; the scrolling on mobile (see
   below) happens on this wrapper rather than on .map-hud--bottom-center
   itself, so the pill stays visually intact (rounded, bordered) as
   content that can spill past this dock's edges instead of being the
   scroll container itself. */
.map-hud-bottom-dock {
  position: absolute;
  z-index: 10;
  left: 50%;
  bottom: 1rem;
  transform: translateX(-50%);
}

/* Not anchored to any particular edge — floats free above the bottom
   edge, fully rounded on all sides. Sized to its content (inline-flex,
   not the base .map-hud's block-level flex) so it can be wider than
   .map-hud-bottom-dock and overflow it (rather than being squeezed to
   fit, or wrapping to a second line) whenever it doesn't fit. */
.map-hud--bottom-center {
  position: static;
  display: inline-flex;
  border-radius: 999px;
}

/* Flex items shrink (and their text wraps) before a flex container
   overflows by default — left alone, that would let labels wrap onto a
   second line before the dock below ever gets a chance to scroll.
   Pinning children to their natural width forces the pill to overflow
   the dock instead, at any viewport width, not just narrow ones. */
.map-hud--bottom-center > * {
  flex-shrink: 0;
  white-space: nowrap;
}

/* Lets the dock scroll (rather than just clip) whenever the pill above
   is too wide for it — always on, not just under the mobile breakpoint
   below, since the never-wrap rule above can now make the pill overflow
   at any width. Setting overflow-x here also makes overflow-y compute to
   auto (never "visible"), which would otherwise clip the pill's own
   box-shadow/glare where it extends past the dock's bounds — the padding
   gives that shadow room to render (and, since padding is part of the
   scrollable area, it stays visible even scrolled to either end). */
.map-hud-bottom-dock {
  overflow-x: auto;
  padding: 1rem;
}

/* The dock has enough controls that a single row can overflow a
   phone-width screen — it scrolls horizontally, edge-to-edge, so the
   pill inside can keep its one-line layout at full natural width. */
@media (max-width: 640px) {
  .map-hud-bottom-dock {
    left: 0;
    right: 0;
    bottom: 0;
    transform: none;
    padding: 10px;
  }
}

.map-hud__divider {
  align-self: stretch;
  width: 1px;
  margin: 0.15rem 0;
  background: #e2e8f0;
}

.map-toolbar__readout {
  font-size: 0.8rem;
  color: #64748b;
  min-width: 3rem;
  text-align: center;
}

.map-toolbar__refresh-arc {
  flex: none;
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

.map-viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background-color: #cbd5e1;
  cursor: grab;
  touch-action: none;
  /* Without this, browsers snap a trackpad's two-finger pan to whichever
     axis dominates ("scroll axis locking") before our wheel handler ever
     sees deltaX/deltaY — undoing that is the whole point of this
     property. Chromium 153+ only for now; harmlessly ignored elsewhere. */
  scroll-axis-lock: none;
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

.map-edge {
  transition: opacity 0.15s;
}

.map-edge--dimmed {
  opacity: 0.2;
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
