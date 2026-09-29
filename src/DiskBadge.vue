<script setup>
// Composite widget for the disk-busy/disk-pending/disk-fill/disk-avail
// metric family (see the doc comment on `metrics:` in stack.yaml) —
// `metrics` is whatever subset of the four a resource actually has, from
// metrics.js's partitionMetricFamilies. Leads with how full the filesystem
// on the disk is, then disk busy % (collectd's disk_io_time, the same thing
// `iostat %util` shows) as a chip colored green→red by how busy that is;
// pending and low remaining space each get their own small chip below, but
// only when there's actually something to flag (a healthy disk queues
// nothing and has room left).

import { computed, watch } from 'vue'
import { diskBusyColor, isDiskBusyCritical, fetchDiskMetrics, formatGiB, resolveMetricQuery } from './metrics.js'
import { useMetric } from './useMetric.js'
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

const emit = defineEmits(['settled', 'critical-change', 'callouts-change'])

const busyMetric = computed(() => props.metrics.find((m) => m.type === 'disk-busy'))
const label = computed(() => (props.multiDisk ? `DISK ${props.disk}:` : 'DISK:'))

// See useMetric.js/CpuBadge.vue — handles the mount+refresh+status
// lifecycle; this badge just derives its own fields from whatever it last
// fetched.
const { status, data, errorMessage } = useMetric(
  () => fetchDiskMetrics(props.metrics, props.resourceId),
  () => emit('settled')
)
const busy = computed(() => data.value?.busy ?? null)
const pending = computed(() => data.value?.pending ?? null)
const pendingElevated = computed(() => data.value?.pendingElevated ?? false)
const fill = computed(() => data.value?.fill ?? null)
const usedBytes = computed(() => data.value?.usedBytes ?? null)
const totalBytes = computed(() => data.value?.totalBytes ?? null)
const availBytes = computed(() => data.value?.availBytes ?? null)
const availLow = computed(() => data.value?.availLow ?? false)

// The bytes the fill % is computed from, for the chip's tooltip — the
// percentage alone doesn't say whether 12% free is 200GB or 2GB, and the
// chip itself has nowhere near the room for both.
const fillTooltip = computed(() =>
  fill.value === null
    ? null
    : `${formatGiB(usedBytes.value, 1)} GB / ${formatGiB(totalBytes.value, 1)} GB used — from node_exporter`
)

const color = computed(() => (busy.value !== null ? diskBusyColor(busy.value) : null))
// A disk running out of room renders in the same red as the top busy tier
// (see the template's __chip--error), so it counts as critical too — and
// it's the less recoverable of the two: a busy disk is slow, a full one
// fails writes outright.
const critical = computed(() => (busy.value !== null && isDiskBusyCritical(busy.value)) || availLow.value)
watch(critical, (val) => emit('critical-change', val), { immediate: true })

// The call-out row below only exists while there's something in it, so this
// badge's height changes as that flips — and `pending` in particular flips
// with live traffic, not just on first load, so the VM box has to re-measure
// when it does. Reported rather than inferred by the parent for the same
// reason `critical` is.
const hasCallouts = computed(() => pendingElevated.value || availLow.value)
watch(hasCallouts, (val) => emit('callouts-change', val), { immediate: true })
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
    <div class="disk-badge__row">
      <span class="disk-badge__label">{{ label }}</span>
      <span v-if="status === 'loading'" class="disk-badge__chip disk-badge__chip--loading">…</span>
      <!-- Neither figure leads: each is shown when it has a value, so a
           disk with only one backend reporting (see fetchDiskMetrics) just
           shows that one rather than a gap or an error. -->
      <template v-else>
        <!-- Uncolored: how full a disk is says nothing on its own about
             whether that's a problem (a data disk sitting at 95% is doing
             its job) — the remaining-space chip below is what alarms. -->
        <span v-if="fill !== null" class="disk-badge__chip disk-badge__chip--plain" :title="fillTooltip">
          Fill {{ fill.toFixed(0) }}%
        </span>

        <span
          v-if="busy !== null"
          class="disk-badge__chip"
          :class="{ 'disk-badge__chip--plain': color.plain }"
          :style="color.plain ? null : { color: color.color, background: color.background }"
        >
          Busy {{ busy.toFixed(0) }}%
        </span>

        <span v-if="fill === null && busy === null" class="disk-badge__chip disk-badge__chip--error">
          unreachable?
        </span>
      </template>
    </div>

    <!-- Own row, not squeezed onto the primary line (same reasoning as
         SolrBadge.vue's) — a multi-disk VM's label already eats a third of
         the 164px box, so either call-out appended after Busy/Fill ran
         past its right edge and got clipped. -->
    <div v-if="pendingElevated || availLow" class="disk-badge__row disk-badge__row--callouts">
      <span
        v-if="pendingElevated"
        class="disk-badge__chip disk-badge__chip--warn"
        title="requests are queueing on this disk rather than completing immediately"
      >
        pending {{ pending.toFixed(0) }}
      </span>

      <span
        v-if="availLow"
        class="disk-badge__chip disk-badge__chip--error"
        title="little space left — writes on this filesystem will start failing"
      >
        {{ formatGiB(availBytes, 1) }}GB left
      </span>
    </div>
  </div>
</template>

<style scoped>
.disk-badge {
  display: flex;
  flex-direction: column;
  gap: 2px;
  cursor: help;
  border-radius: 5px;
}

.disk-badge:hover {
  outline: 1px solid #cbd5e1;
}

.disk-badge__row {
  display: flex;
  align-items: center;
  gap: 3px;
}

/* Indented so it reads as belonging to the disk named on the line above:
   a multi-disk VM stacks these badges with no gap between them, so an
   unindented second line sits closer to the NEXT disk's row than to its
   own. */
.disk-badge__row--callouts {
  padding-left: 9px;
}

.disk-badge__label {
  font-size: 0.55rem;
  font-weight: 600;
  color: #64748b;
  /* Without this the label is the one thing in the row that can wrap, so
     an overflowing row broke "DISK vda:" across two lines rather than
     just running past the edge. */
  white-space: nowrap;
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
