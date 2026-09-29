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
  // Whether this badge may break onto a second line when it doesn't fit.
  // True inside a VM box, where the width is fixed at 164px and the
  // alternative is the swap chip being clipped off the edge; false in the
  // server labels of "Group by server", which are absolutely positioned and
  // free to extend past their box, so wrapping there would split "MEM:"
  // from its own figures for no benefit.
  wrap: { type: Boolean, default: true },
})

const emit = defineEmits(['settled', 'critical-change', 'callouts-change'])

// See useMetric.js/CpuBadge.vue — handles the mount+refresh+status
// lifecycle; this badge just derives its own fields from whatever it last
// fetched.
const { status, data, errorMessage, isStale } = useMetric(
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

// The swap chip appearing is the only thing that changes this badge's
// content, and it's what pushes it onto a second line in a space as narrow
// as a VM box (see the wrapping note in the styles below) — so the box has
// to re-measure when it does. Same reporting contract as DiskBadge's.
watch(swapElevated, (val) => emit('callouts-change', val), { immediate: true })
</script>

<template>
  <div
    class="mem-badge"
    :class="{ 'mem-badge--nowrap': !wrap, 'metric-stale': isStale }"
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
/* Wraps rather than overflowing: the three figures plus a swap call-out run
   wider than a VM box, which used to clip the swap chip off the right edge
   entirely. Left to flexbox rather than being a fixed second row, so it
   only ever takes the extra line when the content genuinely doesn't fit —
   a VM with no swap call-out still reads as one line. */
.mem-badge {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 3px;
  cursor: help;
  border-radius: 5px;
}

/* See the `wrap` prop. */
.mem-badge--nowrap {
  flex-wrap: nowrap;
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
