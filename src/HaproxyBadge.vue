<script setup>
// Composite widget for one haproxy backend pool (see the doc comment on
// `metrics:` in stack.yaml) — `metrics` is whatever subset of
// haproxy-sessions/-limit/-queue/-up/-total this backend actually has, from
// metrics.js's groupHaproxyMetricsByBackend. Shows current sessions as a %
// of the configured limit, colored green→red by how busy that is; queue
// and backend-server health each get their own small call-out, but only
// when there's actually something to flag (a healthy backend queues
// nothing and has every server in rotation).

import { computed, onMounted, ref, watch } from 'vue'
import { haproxySessionsColor, fetchHaproxyMetrics, resolveMetricQuery } from './metrics.js'
import { refreshTick } from './liveRefresh.js'

const props = defineProps({
  metrics: { type: Array, required: true },
  resourceId: { type: String, required: true },
  backend: { type: String, required: true },
})

const emit = defineEmits(['settled'])

const sessionsMetric = computed(() => props.metrics.find((m) => m.type === 'haproxy-sessions'))

const status = ref('loading') // 'loading' | 'ok' | 'error'
const busy = ref(null)
const sessions = ref(null)
const queue = ref(null)
const queueElevated = ref(false)
const up = ref(null)
const total = ref(null)
const healthDegraded = ref(false)
const errorMessage = ref('')

const color = computed(() => (busy.value !== null ? haproxySessionsColor(busy.value) : null))

// See CpuBadge.vue's `hasSettledOnce` — fires once, on this badge's first
// settle, so the parent VmBox can correct a pre-data measurement.
let hasSettledOnce = false

async function load() {
  try {
    const data = await fetchHaproxyMetrics(props.metrics, props.resourceId)
    busy.value = data.busy
    sessions.value = data.sessions
    queue.value = data.queue
    queueElevated.value = data.queueElevated
    up.value = data.up
    total.value = data.total
    healthDegraded.value = data.healthDegraded
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
