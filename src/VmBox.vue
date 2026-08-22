<script setup>
import { computed } from 'vue'
import { metricsFor } from './spec.js'
import { appFor } from './apps.js'
import { partitionMetricFamilies } from './metrics.js'
import MetricBadge from './MetricBadge.vue'
import CpuBadge from './CpuBadge.vue'
import MemBadge from './MemBadge.vue'

const props = defineProps({
  vm: { type: Object, required: true },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
})

const families = computed(() => partitionMetricFamilies(metricsFor(props.vm, 'vm')))
const cpuMetrics = computed(() => families.value.cpuMetrics)
const ramMetrics = computed(() => families.value.ramMetrics)
const otherMetrics = computed(() => families.value.otherMetrics)
const hasMetrics = computed(
  () => cpuMetrics.value.length || ramMetrics.value.length || otherMetrics.value.length
)
</script>

<template>
  <div class="map-vm" :style="{ left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px' }">
    <div class="map-vm__header">
      <span class="map-vm__name">{{ vm.id }}</span>
      <span v-if="vm.role" class="map-vm__role">{{ vm.role }}</span>
    </div>

    <div v-if="hasMetrics" class="map-vm__metrics">
      <div v-if="cpuMetrics.length" class="map-vm__metrics-row">
        <CpuBadge :metrics="cpuMetrics" :resource-id="vm.id" />
      </div>
      <div v-if="ramMetrics.length" class="map-vm__metrics-row">
        <MemBadge :metrics="ramMetrics" :resource-id="vm.id" />
      </div>
      <div v-for="metric in otherMetrics" :key="metric.type" class="map-vm__metrics-row">
        <MetricBadge :metric="metric" :resource-id="vm.id" />
      </div>
    </div>

    <div class="map-vm__divider"></div>

    <div v-if="vm.containers.length" class="map-vm__containers">
      <div v-for="c in vm.containers" :key="c.id" class="map-container" :title="c.role || c.image">
        <img
          v-if="appFor(c.application)?.icon"
          class="map-container__icon"
          :src="appFor(c.application).icon"
          :alt="appFor(c.application).label"
        />
        <span v-else class="map-container__dot" />
        <span class="map-container__label">{{ c.image }}</span>
      </div>
    </div>
    <div v-else class="map-vm__empty">no containers</div>
  </div>
</template>

<style scoped>
.map-vm {
  position: absolute;
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  box-sizing: border-box;
  padding: 4px 6px;
  overflow: hidden;
}

.map-vm__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem;
  margin-bottom: 3px;
}

.map-vm__name {
  font-weight: 600;
  font-size: 0.72rem;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.map-vm__role {
  font-size: 0.6rem;
  color: #94a3b8;
  white-space: nowrap;
}

.map-vm__metrics {
  display: flex;
  flex-direction: column;
}

/* Height must match mapLayout.js's VM_METRICS_ROW — that constant reserves
   one row's worth of box space per metric family actually rendered.
   Spacing before the containers list below comes from .map-vm__divider's
   own margin, not these rows. */
.map-vm__metrics-row {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 14px;
  overflow: hidden;
}

/* Height (incl. margin) must match mapLayout.js's VM_DIVIDER. */
.map-vm__divider {
  height: 1px;
  background: #e2e8f0;
  /* Negative horizontal margin matches .map-vm's own 6px padding, so the
     line reaches the box's edges instead of stopping at the padded area. */
  margin: 5px -6px;
}

.map-vm__containers {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.map-vm__empty {
  font-size: 0.65rem;
  color: #cbd5e1;
  font-style: italic;
}

.map-container {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.65rem;
  height: 20px;
  padding: 0 0.4rem;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  background: #fafafa;
  color: #334155;
  box-sizing: border-box;
}

.map-container__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #94a3b8;
  flex: none;
}

.map-container__icon {
  width: 11px;
  height: 11px;
  flex: none;
  object-fit: contain;
}

.map-container__label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
