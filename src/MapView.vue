<script setup>
import { computed, ref } from 'vue'
import { spec, buildTree, buildEdges, metricsFor } from './spec.js'
import { partitionCpuMetrics } from './metrics.js'
import { liveRefreshEnabled } from './liveRefresh.js'
import {
  computeMapLayout,
  computeFlatMapLayout,
  flattenLayout,
  flattenFlatLayout,
  pointOnRectTowards,
} from './mapLayout.js'
import { layoutExternals, EXTERNAL_ROW_GAP } from './externalLayout.js'
import { usePanZoom } from './usePanZoom.js'
import VmBox from './VmBox.vue'
import ExternalNode from './ExternalNode.vue'
import MetricBadge from './MetricBadge.vue'
import CpuBadge from './CpuBadge.vue'

const groupByServer = ref(false)
const tree = computed(() => buildTree())

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
  if (!groupByServer.value) return computeFlatMapLayout(tree.value, spec.externals)

  const base = computeMapLayout(tree.value)
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
  const boxes = groupByServer.value ? flattenLayout(layout.value) : flattenFlatLayout(layout.value)
  if (groupByServer.value) {
    for (const ep of externalLayout.value.positions) {
      boxes.set(ep.external.id, { x: ep.x, y: ep.y, width: ep.width, height: ep.height })
    }
  }
  const edges = []
  for (const edge of buildEdges()) {
    const fromBox = boxes.get(edge.from)
    const toBox = boxes.get(edge.to)
    if (!fromBox || !toBox) {
      console.warn(`stack-map: relationship references unknown id`, edge)
      continue
    }
    const fromCenter = { x: fromBox.x + fromBox.width / 2, y: fromBox.y + fromBox.height / 2 }
    const toCenter = { x: toBox.x + toBox.width / 2, y: toBox.y + toBox.height / 2 }
    const p1 = pointOnRectTowards(fromBox, toCenter.x, toCenter.y)
    const p2 = pointOnRectTowards(toBox, fromCenter.x, fromCenter.y)
    edges.push({
      id: `${edge.from}=>${edge.to}`,
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      labelX: (p1.x + p2.x) / 2,
      labelY: (p1.y + p2.y) / 2,
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
                v-if="partitionCpuMetrics(metricsFor(s.server, 'server')).cpuMetrics.length"
                :metrics="partitionCpuMetrics(metricsFor(s.server, 'server')).cpuMetrics"
                :resource-id="s.server.id"
              />
              <MetricBadge
                v-for="metric in partitionCpuMetrics(metricsFor(s.server, 'server')).otherMetrics"
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
              :width="vp.width"
              :height="vp.height"
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
              :width="node.width"
              :height="node.height"
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
            <line
              :x1="edge.x1"
              :y1="edge.y1"
              :x2="edge.x2"
              :y2="edge.y2"
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
  </div>
</template>

<style scoped>
.map-view {
  display: flex;
  flex-direction: column;
  height: calc(100svh - 6.5rem);
  padding: 0 1.5rem 1.5rem;
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
  background-color: #f8fafc;
  background-image: radial-gradient(#e2e8f0 1px, transparent 1px);
  background-size: 20px 20px;
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
