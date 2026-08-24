<script setup>
// Composite widget for the cpu-busy/cpu-wait/cpu-steal metric family (see
// the doc comment on `metrics:` in stack.yaml) — `metrics` is whatever
// subset of the three a resource actually has, from
// metrics.js's partitionMetricFamilies. Shows CPU busy % as a colored chip,
// green→red by how busy that is; wait/steal get their own small chips
// alongside it, but only when they're elevated enough to suggest the
// strain isn't purely compute-bound.

import { computed, watch } from 'vue'
import { cpuBusyColor, isCpuBusyCritical, fetchCpuMetrics, resolveMetricQuery } from './metrics.js'
import { useMetric } from './useMetric.js'
import { openCpuExplainer } from './cpuExplainer.js'

const props = defineProps({
  metrics: { type: Array, required: true },
  resourceId: { type: String, required: true },
})

const emit = defineEmits(['settled', 'critical-change'])

const busyMetric = computed(() => props.metrics.find((m) => m.type === 'cpu-busy'))

// See useMetric.js — handles the mount+refresh+status lifecycle; this
// badge just derives its own fields from whatever it last fetched.
const { status, data, errorMessage } = useMetric(
  () => fetchCpuMetrics(props.metrics, props.resourceId),
  () => emit('settled')
)
const busy = computed(() => data.value?.busy ?? null)
const wait = computed(() => data.value?.wait ?? null)
const waitElevated = computed(() => data.value?.waitElevated ?? false)
const steal = computed(() => data.value?.steal ?? null)
const stealElevated = computed(() => data.value?.stealElevated ?? false)

const color = computed(() => (busy.value !== null ? cpuBusyColor(busy.value) : null))
const critical = computed(() => busy.value !== null && isCpuBusyCritical(busy.value))
// `immediate` reports the initial (non-critical) state right away, so the
// parent VM box doesn't have to assume "not critical yet" on its own.
watch(critical, (val) => emit('critical-change', val), { immediate: true })
</script>

<template>
  <div
    class="cpu-badge"
    role="button"
    tabindex="0"
    :title="
      (status === 'error'
        ? `fetch failed: ${errorMessage}`
        : busyMetric && resolveMetricQuery(busyMetric, resourceId)) + ' — click for what these mean'
    "
    @click="openCpuExplainer()"
    @keydown.enter="openCpuExplainer()"
  >
    <span class="cpu-badge__label">CPU:</span>
    <span v-if="status === 'loading'" class="cpu-badge__chip cpu-badge__chip--loading">…</span>
    <span
      v-else-if="busy !== null"
      class="cpu-badge__chip"
      :class="{ 'cpu-badge__chip--plain': color.plain }"
      :style="color.plain ? null : { color: color.color, background: color.background }"
    >
      Busy {{ busy.toFixed(0) }}%
    </span>
    <span v-else class="cpu-badge__chip cpu-badge__chip--error">unreachable?</span>

    <span
      v-if="waitElevated"
      class="cpu-badge__chip cpu-badge__chip--warn"
      title="elevated I/O wait — likely disk/network-bound, not compute-bound"
    >
      wait {{ wait.toFixed(0) }}%
    </span>
    <span
      v-if="stealElevated"
      class="cpu-badge__chip cpu-badge__chip--warn"
      title="elevated CPU steal — the underlying VM host may be oversubscribed"
    >
      steal {{ steal.toFixed(0) }}%
    </span>
  </div>
</template>

<style scoped>
.cpu-badge {
  display: flex;
  align-items: center;
  gap: 3px;
  cursor: help;
  border-radius: 5px;
}

.cpu-badge:hover {
  outline: 1px solid #cbd5e1;
}

.cpu-badge__label {
  font-size: 0.55rem;
  font-weight: 600;
  color: #64748b;
}

.cpu-badge__chip {
  font-size: 0.55rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 4px;
  white-space: nowrap;
}

.cpu-badge__chip--loading {
  color: #94a3b8;
}

.cpu-badge__chip--plain {
  font-weight: 400;
  color: #64748b;
  background: none;
}

.cpu-badge__chip--error {
  color: #b91c1c;
  background: #fee2e2;
}

.cpu-badge__chip--warn {
  color: #9a3412;
  background: #ffedd5;
}
</style>
