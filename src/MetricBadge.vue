<script setup>
// Generic single-metric badge: "TYPE value", live-refreshed on the shared
// 30s timer. Used for anything that isn't part of the cpu-busy/cpu-wait/
// cpu-steal family — those get grouped into one CpuBadge by the caller
// (see metrics.js's partitionCpuMetrics) before this component ever sees
// them, so it doesn't need to know that family exists.

import { computed } from 'vue'
import { fetchLatestMetric, resolveMetricQuery, customMetricColor } from './metrics.js'
import { useMetric } from './useMetric.js'

const props = defineProps({
  metric: { type: Object, required: true },
  resourceId: { type: String, required: true },
})

const emit = defineEmits(['settled'])

// See useMetric.js/CpuBadge.vue — handles the mount+refresh+status
// lifecycle; this badge just derives its own fields from whatever it last
// fetched. `data` here is the raw backend result itself ({value,
// timestamp, window}), not a composite object like the other badges'
// fetchXMetrics — there's nothing to derive beyond unwrapping `.value`.
const { status, data, errorMessage } = useMetric(
  () => fetchLatestMetric(props.metric, props.resourceId),
  () => emit('settled')
)
const value = computed(() => data.value?.value ?? null)

// `type: custom` carries its own display name/unit/thresholds in
// stack.yaml, rather than this component hardcoding a per-type table the
// way CpuBadge/MemBadge/etc. do for their own families — see stack.yaml's
// metrics doc comment.
const isCustom = computed(() => props.metric.type === 'custom')
const label = computed(() => (isCustom.value ? props.metric.name : props.metric.type.toUpperCase()))
const unit = computed(() => (isCustom.value ? (props.metric.unit ?? '') : ''))
const color = computed(() =>
  isCustom.value && value.value !== null ? customMetricColor(value.value, props.metric.thresholds) : null
)
</script>

<template>
  <div
    class="metric-badge"
    :title="status === 'error' ? `fetch failed: ${errorMessage}` : resolveMetricQuery(metric, resourceId)"
  >
    <span v-if="status === 'loading'" class="metric-badge__value metric-badge__value--loading">…</span>
    <span
      v-else-if="value !== null"
      class="metric-badge__value"
      :class="{ 'metric-badge__value--ok': !isCustom, 'metric-badge__value--plain': isCustom && color?.plain }"
      :style="color && !color.plain ? { color: color.color, background: color.background } : null"
    >
      {{ label }} {{ value.toFixed(2) }}{{ unit }}
    </span>
    <span v-else class="metric-badge__value metric-badge__value--error">api unreachable?</span>
  </div>
</template>

<style scoped>
.metric-badge {
  display: flex;
  align-items: center;
}

.metric-badge__value {
  font-size: 0.55rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 4px;
  white-space: nowrap;
}

.metric-badge__value--loading {
  color: #94a3b8;
}

.metric-badge__value--ok {
  color: #15803d;
  background: #dcfce7;
}

.metric-badge__value--error {
  color: #b91c1c;
  background: #fee2e2;
}

/* A `custom` metric's normal/healthy tier — same idea as CpuBadge's
   `--plain` chip: unbolded and uncolored, so a badge only draws the eye
   once there's actually something to look at. */
.metric-badge__value--plain {
  font-weight: 400;
}
</style>
