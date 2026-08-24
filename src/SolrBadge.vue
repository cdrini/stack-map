<script setup>
// Composite widget for one solr handler's (/select, /get, /update, ...)
// request-rate/-error-rate/-timeout-rate metrics (see the doc comment on
// `metrics:` in stack.yaml) — `metrics` is whatever subset this handler
// actually has, from metrics.js's groupSolrMetricsByHandler. Unlike
// CPU/RAM/disk/haproxy, request rate isn't colored by a busy tier — more
// traffic isn't inherently a problem — so it shows as a plain figure;
// error % and timeout % each get their own small call-out, but only when
// there's actually something to flag (only /select tracks these at all,
// and even there a healthy endpoint sits at essentially zero).

import { computed, watch } from 'vue'
import { fetchSolrMetrics, resolveMetricQuery } from './metrics.js'
import { useMetric } from './useMetric.js'

const props = defineProps({
  metrics: { type: Array, required: true },
  resourceId: { type: String, required: true },
  handler: { type: String, required: true },
})

const emit = defineEmits(['settled', 'empty-change'])

const requestRateMetric = computed(() => props.metrics.find((m) => m.type === 'solr-request-rate'))

// See useMetric.js/CpuBadge.vue — handles the mount+refresh+status
// lifecycle; this badge just derives its own fields from whatever it last
// fetched.
const { status, data, errorMessage } = useMetric(
  () => fetchSolrMetrics(props.metrics, props.resourceId),
  () => emit('settled')
)
const requestsPerSecond = computed(() => data.value?.requestsPerSecond ?? null)
const errorPercent = computed(() => data.value?.errorPercent ?? null)
const errorElevated = computed(() => data.value?.errorElevated ?? false)
const timeoutPercent = computed(() => data.value?.timeoutPercent ?? null)
const timeoutElevated = computed(() => data.value?.timeoutElevated ?? false)

// Compact thousands (7.7K rather than 7700) — the /min figure runs into
// 4-5 digits often enough on /select that spelling it out was pushing the
// row wider than the 150px container has room for.
function formatCompact(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : n.toFixed(0)
}
const requestsPerMinute = computed(() =>
  requestsPerSecond.value !== null ? formatCompact(requestsPerSecond.value * 60) : null
)
// req/s rounds to 0 far more often than req/min does (a fraction of a
// request per second is still several per minute) — showing "0 req/s"
// alongside a genuinely informative req/min figure is just noise, so it's
// dropped rather than displayed as a misleading zero.
const showPerSecond = computed(() => requestsPerSecond.value !== null && Math.round(requestsPerSecond.value) !== 0)

// A handler this particular node just never sees traffic on (e.g. /update
// on a read-only follower) clutters the box for no benefit — hidden
// entirely once BOTH displayed figures round to 0, rather than left
// showing "0 req/s • 0 req/min". Judged by the same rounding the template
// actually displays (not the raw value), so it matches what's on screen;
// `null` (still loading, or never successfully fetched) is never
// considered empty — only a confirmed, genuinely-zero reading is.
const isEmpty = computed(
  () =>
    requestsPerSecond.value !== null &&
    Math.round(requestsPerSecond.value) === 0 &&
    Math.round(requestsPerSecond.value * 60) === 0
)
watch(isEmpty, (val) => emit('empty-change', val), { immediate: true })
</script>

<template>
  <div
    class="solr-badge"
    :title="
      status === 'error' ? `fetch failed: ${errorMessage}` : requestRateMetric && resolveMetricQuery(requestRateMetric, resourceId)
    "
  >
    <div class="solr-badge__row">
      <span class="solr-badge__label">{{ handler }}:</span>
      <span v-if="status === 'loading'" class="solr-badge__chip solr-badge__chip--loading">…</span>
      <span v-else-if="requestsPerSecond !== null" class="solr-badge__chip solr-badge__chip--plain">
        <template v-if="showPerSecond">{{ requestsPerSecond.toFixed(0) }} req/s &bull; </template>{{ requestsPerMinute }} req/min
      </span>
      <span v-else class="solr-badge__chip solr-badge__chip--error">unreachable?</span>
    </div>

    <!-- Own row, not squeezed onto the primary line — combined they ran
         wider than the 150px container has room for. -->
    <div v-if="errorElevated || timeoutElevated" class="solr-badge__row">
      <span
        v-if="errorElevated"
        class="solr-badge__chip solr-badge__chip--warn"
        title="requests returning an error, as a % of all /select requests"
      >
        err {{ errorPercent.toFixed(1) }}%
      </span>
      <span
        v-if="timeoutElevated"
        class="solr-badge__chip solr-badge__chip--warn"
        title="requests timing out, as a % of all /select requests"
      >
        timeout {{ timeoutPercent.toFixed(1) }}%
      </span>
    </div>
  </div>
</template>

<style scoped>
.solr-badge {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.solr-badge__row {
  display: flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}

.solr-badge__label {
  font-size: 0.55rem;
  font-weight: 600;
  color: #64748b;
  white-space: nowrap;
}

.solr-badge__chip {
  font-size: 0.55rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 4px;
  white-space: nowrap;
}

.solr-badge__chip--loading {
  color: #94a3b8;
}

.solr-badge__chip--plain {
  font-weight: 400;
  color: #64748b;
  background: none;
}

.solr-badge__chip--error {
  color: #b91c1c;
  background: #fee2e2;
}

.solr-badge__chip--warn {
  color: #9a3412;
  background: #ffedd5;
}
</style>
