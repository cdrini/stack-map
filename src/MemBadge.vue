<script setup>
// Composite widget for the mem-*/swap-* metric family (see the doc comment
// on `metrics:` in stack.yaml) — `metrics` is whatever subset of the eight
// a resource actually has, from metrics.js's partitionMetricFamilies.
// Shows RAM busy % ((used + slab-unrecl) / total) as a colored chip,
// green→red by how busy that is; swap gets its own small chip alongside
// it, but only when it's elevated enough to suggest actual memory
// exhaustion rather than just "somewhat full."

import { computed, watch } from 'vue'
import { ramBusyColor, isRamBusyCritical, fetchRamMetrics, formatGiB } from './metrics.js'
import { useMetric } from './useMetric.js'
import { openRamExplainer } from './ramExplainer.js'

const props = defineProps({
  metrics: { type: Array, required: true },
  resourceId: { type: String, required: true },
})

const emit = defineEmits(['settled', 'critical-change'])

// See useMetric.js/CpuBadge.vue — handles the mount+refresh+status
// lifecycle; this badge just derives its own fields from whatever it last
// fetched.
const { status, data, errorMessage } = useMetric(
  () => fetchRamMetrics(props.metrics, props.resourceId),
  () => emit('settled')
)
const busy = computed(() => data.value?.busy ?? null)
const usedBytes = computed(() => data.value?.usedBytes ?? null)
const cachedBytes = computed(() => data.value?.cachedBytes ?? null)
const totalBytes = computed(() => data.value?.totalBytes ?? null)
const swapPercent = computed(() => data.value?.swapPercent ?? null)
const swapElevated = computed(() => data.value?.swapElevated ?? false)

const color = computed(() => (busy.value !== null ? ramBusyColor(busy.value) : null))
const critical = computed(() => busy.value !== null && isRamBusyCritical(busy.value))
watch(critical, (val) => emit('critical-change', val), { immediate: true })
</script>

<template>
  <div
    class="mem-badge"
    role="button"
    tabindex="0"
    :title="
      (status === 'error'
        ? `fetch failed: ${errorMessage}`
        : 'RAM: used+non-reclaimable slab / cached / total') + ' — click for what these mean'
    "
    @click="openRamExplainer()"
    @keydown.enter="openRamExplainer()"
  >
    <span class="mem-badge__label">MEM:</span>
    <span v-if="status === 'loading'" class="mem-badge__chip mem-badge__chip--loading">…</span>
    <span
      v-else-if="busy !== null"
      class="mem-badge__chip"
      :class="{ 'mem-badge__chip--plain': color.plain }"
      :style="color.plain ? null : { color: color.color, background: color.background }"
    >
      {{ formatGiB(usedBytes, 1) }} / {{ formatGiB(cachedBytes, 1) }} / {{ formatGiB(totalBytes, 1) }}GB ({{
        busy.toFixed(0)
      }}%)
    </span>
    <span v-else class="mem-badge__chip mem-badge__chip--error">unreachable?</span>

    <span
      v-if="swapElevated"
      class="mem-badge__chip mem-badge__chip--warn"
      title="non-negligible swap usage — this VM is likely genuinely out of RAM"
    >
      swap {{ swapPercent.toFixed(0) }}%
    </span>
  </div>
</template>

<style scoped>
.mem-badge {
  display: flex;
  align-items: center;
  gap: 3px;
  cursor: help;
  border-radius: 5px;
}

.mem-badge:hover {
  outline: 1px solid #cbd5e1;
}

.mem-badge__label {
  font-size: 0.55rem;
  font-weight: 600;
  color: #64748b;
}

.mem-badge__chip {
  font-size: 0.55rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 4px;
  white-space: nowrap;
}

.mem-badge__chip--loading {
  color: #94a3b8;
}

.mem-badge__chip--plain {
  font-weight: 400;
  color: #64748b;
  background: none;
}

.mem-badge__chip--error {
  color: #b91c1c;
  background: #fee2e2;
}

.mem-badge__chip--warn {
  color: #9a3412;
  background: #ffedd5;
}
</style>
