<script setup>
// Composite widget for the disk-busy/disk-pending metric family (see the
// doc comment on `metrics:` in stack.yaml) — `metrics` is whatever subset
// of the two a resource actually has, from metrics.js's
// partitionMetricFamilies. Shows disk busy % (collectd's disk_io_time,
// the same thing `iostat %util` shows) as a colored chip, green→red by
// how busy that is; pending gets its own small chip alongside it, but
// only when requests are actually backing up rather than a normal
// occasional blip.

import { computed, onMounted, ref, watch } from 'vue'
import { diskBusyColor, isDiskBusyCritical, fetchDiskMetrics, resolveMetricQuery } from './metrics.js'
import { refreshTick } from './liveRefresh.js'
import { openDiskExplainer } from './diskExplainer.js'

const props = defineProps({
  metrics: { type: Array, required: true },
  resourceId: { type: String, required: true },
  disk: { type: String, required: true },
  // Only true when this VM has more than one disk — a single-disk VM
  // (the common case) keeps the plain "DISK:" label instead of naming a
  // device nobody needs disambiguated.
  multiDisk: { type: Boolean, default: false },
})

const emit = defineEmits(['settled', 'critical-change'])

const busyMetric = computed(() => props.metrics.find((m) => m.type === 'disk-busy'))
const label = computed(() => (props.multiDisk ? `DISK ${props.disk}:` : 'DISK:'))

const status = ref('loading') // 'loading' | 'ok' | 'error'
const busy = ref(null)
const pending = ref(null)
const pendingElevated = ref(false)
const errorMessage = ref('')

const color = computed(() => (busy.value !== null ? diskBusyColor(busy.value) : null))
const critical = computed(() => busy.value !== null && isDiskBusyCritical(busy.value))
watch(critical, (val) => emit('critical-change', val), { immediate: true })

// See CpuBadge.vue's `hasSettledOnce` — fires once, on this badge's first
// settle, so the parent VmBox can correct a pre-data measurement.
let hasSettledOnce = false

async function load() {
  try {
    const data = await fetchDiskMetrics(props.metrics, props.resourceId)
    busy.value = data.busy
    pending.value = data.pending
    pendingElevated.value = data.pendingElevated
    status.value = 'ok'
  } catch (e) {
    // Keep the last good value on screen rather than blanking it — a
    // failed refresh doesn't mean the previous reading is now wrong.
    errorMessage.value = e instanceof Error ? e.message : String(e)
    status.value = 'error'
  }
  if (!hasSettledOnce) {
    hasSettledOnce = true
    emit('settled')
  }
}

onMounted(load)
watch(refreshTick, load)
</script>

<template>
  <div
    class="disk-badge"
    role="button"
    tabindex="0"
    :title="
      (status === 'error'
        ? `fetch failed: ${errorMessage}`
        : busyMetric && resolveMetricQuery(busyMetric, resourceId)) + ' — click for what these mean'
    "
    @click="openDiskExplainer()"
    @keydown.enter="openDiskExplainer()"
  >
    <span class="disk-badge__label">{{ label }}</span>
    <span v-if="status === 'loading'" class="disk-badge__chip disk-badge__chip--loading">…</span>
    <span
      v-else-if="busy !== null"
      class="disk-badge__chip"
      :class="{ 'disk-badge__chip--plain': color.plain }"
      :style="color.plain ? null : { color: color.color, background: color.background }"
    >
      Busy {{ busy.toFixed(0) }}%
    </span>
    <span v-else class="disk-badge__chip disk-badge__chip--error">unreachable?</span>

    <span
      v-if="pendingElevated"
      class="disk-badge__chip disk-badge__chip--warn"
      title="requests are queueing on this disk rather than completing immediately"
    >
      pending {{ pending.toFixed(0) }}
    </span>
  </div>
</template>

<style scoped>
.disk-badge {
  display: flex;
  align-items: center;
  gap: 3px;
  cursor: help;
  border-radius: 5px;
}

.disk-badge:hover {
  outline: 1px solid #cbd5e1;
}

.disk-badge__label {
  font-size: 0.55rem;
  font-weight: 600;
  color: #64748b;
}

.disk-badge__chip {
  font-size: 0.55rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 4px;
  white-space: nowrap;
}

.disk-badge__chip--loading {
  color: #94a3b8;
}

.disk-badge__chip--plain {
  font-weight: 400;
  color: #64748b;
  background: none;
}

.disk-badge__chip--error {
  color: #b91c1c;
  background: #fee2e2;
}

.disk-badge__chip--warn {
  color: #9a3412;
  background: #ffedd5;
}
</style>
