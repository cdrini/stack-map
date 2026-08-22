<script setup>
// Composite widget for the mem-*/swap-* metric family (see the doc comment
// on `metrics:` in stack.yaml) — `metrics` is whatever subset of the eight
// a resource actually has, from metrics.js's partitionMetricFamilies.
// Shows RAM busy % ((used + slab-unrecl) / total) as a colored chip,
// green→red by how busy that is; swap gets its own small chip alongside
// it, but only when it's elevated enough to suggest actual memory
// exhaustion rather than just "somewhat full."

import { computed, onMounted, ref, watch } from 'vue'
import { ramBusyColor, fetchRamMetrics, formatGiB } from './metrics.js'
import { refreshTick } from './liveRefresh.js'

const props = defineProps({
  metrics: { type: Array, required: true },
  resourceId: { type: String, required: true },
})

const status = ref('loading') // 'loading' | 'ok' | 'error'
const busy = ref(null)
const usedBytes = ref(null)
const totalBytes = ref(null)
const swapPercent = ref(null)
const swapElevated = ref(false)
const errorMessage = ref('')

const color = computed(() => (busy.value !== null ? ramBusyColor(busy.value) : null))

async function load() {
  try {
    const data = await fetchRamMetrics(props.metrics, props.resourceId)
    busy.value = data.busy
    usedBytes.value = data.usedBytes
    totalBytes.value = data.totalBytes
    swapPercent.value = data.swapPercent
    swapElevated.value = data.swapElevated
    status.value = 'ok'
  } catch (e) {
    // Keep the last good value on screen rather than blanking it — a
    // failed refresh doesn't mean the previous reading is now wrong.
    errorMessage.value = e instanceof Error ? e.message : String(e)
    status.value = 'error'
  }
}

onMounted(load)
watch(refreshTick, load)
</script>

<template>
  <div class="mem-badge" :title="status === 'error' ? `fetch failed: ${errorMessage}` : 'RAM: used + non-reclaimable slab, as % of total'">
    <span class="mem-badge__label">MEM:</span>
    <span v-if="status === 'loading'" class="mem-badge__chip mem-badge__chip--loading">…</span>
    <span
      v-else-if="busy !== null"
      class="mem-badge__chip"
      :style="{ color: color.color, background: color.background }"
    >
      {{ formatGiB(usedBytes, 1) }} / {{ formatGiB(totalBytes, 1) }}GB ({{ busy.toFixed(0) }}%)
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

.mem-badge__chip--error {
  color: #b91c1c;
  background: #fee2e2;
}

.mem-badge__chip--warn {
  color: #9a3412;
  background: #ffedd5;
}
</style>
