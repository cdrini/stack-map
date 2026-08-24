<script setup>
// Composite widget for one haproxy backend pool (see the doc comment on
// `metrics:` in stack.yaml) — `metrics` is whatever subset of
// haproxy-sessions/-limit/-queue/-up/-total this backend actually has, from
// metrics.js's groupHaproxyMetricsByBackend. Shows current sessions as a %
// of the configured limit, colored green→red by how busy that is; queue
// and backend-server health each get their own small call-out, but only
// when there's actually something to flag (a healthy backend queues
// nothing and has every server in rotation).

import { computed, watch } from 'vue'
import { haproxySessionsColor, isHaproxySessionsCritical, fetchHaproxyMetrics, resolveMetricQuery } from './metrics.js'
import { useMetric } from './useMetric.js'

const props = defineProps({
  metrics: { type: Array, required: true },
  resourceId: { type: String, required: true },
  backend: { type: String, required: true },
})

const emit = defineEmits(['settled', 'critical-change'])

const sessionsMetric = computed(() => props.metrics.find((m) => m.type === 'haproxy-sessions'))

// See useMetric.js/CpuBadge.vue — handles the mount+refresh+status
// lifecycle; this badge just derives its own fields from whatever it last
// fetched.
const { status, data, errorMessage } = useMetric(
  () => fetchHaproxyMetrics(props.metrics, props.resourceId),
  () => emit('settled')
)
const busy = computed(() => data.value?.busy ?? null)
const sessions = computed(() => data.value?.sessions ?? null)
const queue = computed(() => data.value?.queue ?? null)
const queueElevated = computed(() => data.value?.queueElevated ?? false)
const up = computed(() => data.value?.up ?? null)
const total = computed(() => data.value?.total ?? null)
const healthDegraded = computed(() => data.value?.healthDegraded ?? false)

const color = computed(() => (busy.value !== null ? haproxySessionsColor(busy.value) : null))
// A backend server being pulled from rotation renders in the same red as
// the top sessions tier (see the template's __chip--error), so it counts
// as critical too — a downed server is at least as urgent as high load.
const critical = computed(() => (busy.value !== null && isHaproxySessionsCritical(busy.value)) || healthDegraded.value)
watch(critical, (val) => emit('critical-change', val), { immediate: true })
</script>

<template>
  <div
    class="haproxy-badge"
    :title="
      status === 'error' ? `fetch failed: ${errorMessage}` : sessionsMetric && resolveMetricQuery(sessionsMetric, resourceId)
    "
  >
    <span class="haproxy-badge__label">{{ backend }}:</span>
    <span v-if="status === 'loading'" class="haproxy-badge__chip haproxy-badge__chip--loading">…</span>
    <span
      v-else-if="busy !== null"
      class="haproxy-badge__chip"
      :class="{ 'haproxy-badge__chip--plain': color.plain }"
      :style="color.plain ? null : { color: color.color, background: color.background }"
    >
      {{ sessions.toFixed(0) }} sessions ({{ busy.toFixed(0) }}%)
    </span>
    <span v-else class="haproxy-badge__chip haproxy-badge__chip--error">unreachable?</span>

    <span
      v-if="queueElevated"
      class="haproxy-badge__chip haproxy-badge__chip--warn"
      title="requests are queueing rather than being served immediately"
    >
      queue {{ queue.toFixed(0) }}
    </span>

    <span
      v-if="healthDegraded"
      class="haproxy-badge__chip haproxy-badge__chip--error"
      :title="`${up} of ${total} backend servers are up`"
    >
      {{ up }}/{{ total }} up
    </span>
  </div>
</template>

<style scoped>
.haproxy-badge {
  display: flex;
  align-items: center;
  gap: 3px;
}

.haproxy-badge__label {
  font-size: 0.55rem;
  font-weight: 600;
  color: #64748b;
}

.haproxy-badge__chip {
  font-size: 0.55rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 4px;
  white-space: nowrap;
}

.haproxy-badge__chip--loading {
  color: #94a3b8;
}

.haproxy-badge__chip--plain {
  font-weight: 400;
  color: #64748b;
  background: none;
}

.haproxy-badge__chip--error {
  color: #b91c1c;
  background: #fee2e2;
}

.haproxy-badge__chip--warn {
  color: #9a3412;
  background: #ffedd5;
}
</style>
