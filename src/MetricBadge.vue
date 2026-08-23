<script setup>
// Generic single-metric badge: "TYPE value", live-refreshed on the shared
// 30s timer. Used for anything that isn't part of the cpu-busy/cpu-wait/
// cpu-steal family — those get grouped into one CpuBadge by the caller
// (see metrics.js's partitionCpuMetrics) before this component ever sees
// them, so it doesn't need to know that family exists.

import { computed, onMounted, ref, watch } from 'vue'
import { fetchLatestMetric, resolveMetricQuery, customMetricColor } from './metrics.js'
import { refreshTick } from './liveRefresh.js'

const props = defineProps({
  metric: { type: Object, required: true },
  resourceId: { type: String, required: true },
})

const emit = defineEmits(['settled'])

const status = ref('loading') // 'loading' | 'ok' | 'error'
const value = ref(null)
const errorMessage = ref('')

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

// See CpuBadge.vue's `hasSettledOnce` — fires once, on this badge's first
// settle, so the parent VmBox can correct a pre-data measurement.
let hasSettledOnce = false

async function load() {
  try {
    const data = await fetchLatestMetric(props.metric, props.resourceId)
    value.value = data.value
    status.value = 'ok'
  } catch (e) {
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
