<script setup>
import { computed, onMounted, ref } from 'vue'
import { metricsFor } from './spec.js'
import { appFor } from './apps.js'
import { partitionMetricFamilies, groupDiskMetricsByDisk, groupHaproxyMetricsByBackend } from './metrics.js'
import MetricBadge from './MetricBadge.vue'
import CpuBadge from './CpuBadge.vue'
import MemBadge from './MemBadge.vue'
import DiskBadge from './DiskBadge.vue'
import HaproxyBadge from './HaproxyBadge.vue'

const props = defineProps({
  vm: { type: Object, required: true },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
})

const emit = defineEmits(['first-metrics-settled'])

const families = computed(() => partitionMetricFamilies(metricsFor(props.vm, 'vm')))
const cpuMetrics = computed(() => families.value.cpuMetrics)
const ramMetrics = computed(() => families.value.ramMetrics)
const diskMetrics = computed(() => families.value.diskMetrics)
const diskGroups = computed(() => groupDiskMetricsByDisk(diskMetrics.value))
const otherMetrics = computed(() => families.value.otherMetrics)
const hasMetrics = computed(
  () =>
    cpuMetrics.value.length ||
    ramMetrics.value.length ||
    diskMetrics.value.length ||
    otherMetrics.value.length
)

// A container can carry its own metrics too (currently just haproxy-*,
// see stack.yaml) — unlike the VM-level families above, these are specific
// to one container, so they're keyed by container id rather than being a
// single flat list.
const haproxyGroupsByContainer = computed(() =>
  Object.fromEntries(
    props.vm.containers.map((c) => [
      c.id,
      groupHaproxyMetricsByBackend(partitionMetricFamilies(metricsFor(c, 'container')).haproxyMetrics),
    ])
  )
)

// Rather than hand-tracking header/row/divider pixel heights in mapLayout.js
// (a stack of independently-evolvable numbers that drifted out of sync with
// this file's CSS more than once), the box just renders at its natural
// intrinsic height and the caller measures it directly via `measure()` — see
// MapView.vue's calibration pool. Badge row count is the one thing that
// isn't yet knowable at mount (it depends on which metric families this VM
// and its containers actually have, same as mapLayout.js used to compute),
// so it's still tracked here — not for sizing, but to know when every badge
// (VM-level and container-level) has completed its first fetch, so a
// hidden/hastily-measured box can be corrected once real content (rather
// than a loading placeholder) has settled in.
const totalBadges = computed(() => {
  const vmBadges =
    (cpuMetrics.value.length ? 1 : 0) + (ramMetrics.value.length ? 1 : 0) + diskGroups.value.length + otherMetrics.value.length
  const containerBadges = Object.values(haproxyGroupsByContainer.value).reduce(
    (sum, groups) => sum + groups.length,
    0
  )
  return vmBadges + containerBadges
})
let settledCount = 0
let hasEmittedSettled = false
function checkAllSettled() {
  if (hasEmittedSettled || settledCount < totalBadges.value) return
  hasEmittedSettled = true
  emit('first-metrics-settled', props.vm.id)
}
function onBadgeSettled() {
  settledCount++
  checkAllSettled()
}
onMounted(checkAllSettled) // handles the zero-badges case, where nothing else would ever call this

// Tracks which badges (by a stable per-badge key) currently consider
// themselves critical (see each badge's own `critical` computed) — a Map
// rather than a plain count so a badge flipping back to healthy on a later
// refresh correctly removes its own entry instead of just decrementing a
// counter that some other badge might also be incrementing at the same
// time. Reassigned (not mutated) on each update, same pattern as
// MapView.vue's measuredSizes, since a plain ref doesn't track Map mutation.
const criticalStatuses = ref(new Map())
function setCritical(key, isCritical) {
  const next = new Map(criticalStatuses.value)
  if (isCritical) next.set(key, true)
  else next.delete(key)
  criticalStatuses.value = next
}
const hasCriticalMetric = computed(() => criticalStatuses.value.size > 0)

const rootEl = ref(null)
const containerEls = {}
function setContainerEl(id, el) {
  if (el) containerEls[id] = el
  else delete containerEls[id]
}

// Reads this box's actual rendered geometry — its own size, plus each
// container's position/size relative to it — instead of predicting it from
// constants. `scale` divides out the pan/zoom transform when measuring a
// real, positioned instance inside `.map-world`; the hidden calibration
// pool sits outside that transform, so it's measured at the default scale
// of 1 (raw CSS pixels, already "world units").
function measure(scale = 1) {
  const box = rootEl.value.getBoundingClientRect()
  const containers = props.vm.containers.map((c) => {
    const r = containerEls[c.id].getBoundingClientRect()
    return {
      id: c.id,
      x: (r.left - box.left) / scale,
      y: (r.top - box.top) / scale,
      width: r.width / scale,
      height: r.height / scale,
    }
  })
  return { width: box.width / scale, height: box.height / scale, containers }
}

defineExpose({ measure })
</script>

<template>
  <div
    ref="rootEl"
    class="map-vm"
    :class="{ 'map-vm--critical': hasCriticalMetric }"
    :style="{ left: x + 'px', top: y + 'px' }"
  >
    <div class="map-vm__header">
      <span class="map-vm__name">{{ vm.id }}</span>
      <span v-if="vm.role" class="map-vm__role">{{ vm.role }}</span>
    </div>

    <div v-if="hasMetrics" class="map-vm__metrics">
      <div v-if="cpuMetrics.length" class="map-vm__metrics-row">
        <CpuBadge
          :metrics="cpuMetrics"
          :resource-id="vm.id"
          @settled="onBadgeSettled"
          @critical-change="(v) => setCritical('cpu', v)"
        />
      </div>
      <div v-if="ramMetrics.length" class="map-vm__metrics-row">
        <MemBadge
          :metrics="ramMetrics"
          :resource-id="vm.id"
          @settled="onBadgeSettled"
          @critical-change="(v) => setCritical('ram', v)"
        />
      </div>
      <div v-for="group in diskGroups" :key="'disk-' + group.disk" class="map-vm__metrics-row">
        <DiskBadge
          :metrics="group.metrics"
          :disk="group.disk"
          :multi-disk="diskGroups.length > 1"
          :resource-id="vm.id"
          @settled="onBadgeSettled"
          @critical-change="(v) => setCritical('disk:' + group.disk, v)"
        />
      </div>
      <div v-for="metric in otherMetrics" :key="metric.type" class="map-vm__metrics-row">
        <MetricBadge :metric="metric" :resource-id="vm.id" @settled="onBadgeSettled" />
      </div>
    </div>

    <div class="map-vm__divider"></div>

    <div v-if="vm.containers.length" class="map-vm__containers">
      <div
        v-for="c in vm.containers"
        :key="c.id"
        :ref="(el) => setContainerEl(c.id, el)"
        class="map-container"
      >
        <div class="map-container__header" :title="c.role || c.image">
          <img
            v-if="appFor(c.application)?.icon"
            class="map-container__icon"
            :src="appFor(c.application).icon"
            :alt="appFor(c.application).label"
          />
          <span v-else class="map-container__dot" />
          <span class="map-container__label">{{ c.image }}</span>
        </div>
        <div v-if="haproxyGroupsByContainer[c.id].length" class="map-container__backends">
          <div v-for="group in haproxyGroupsByContainer[c.id]" :key="'haproxy-' + group.backend" class="map-container__backend">
            <HaproxyBadge
              :metrics="group.metrics"
              :backend="group.backend"
              :resource-id="c.id"
              @settled="onBadgeSettled"
              @critical-change="(v) => setCritical('haproxy:' + c.id + ':' + group.backend, v)"
            />
          </div>
        </div>
      </div>
    </div>
    <div v-else class="map-vm__empty">no containers</div>
  </div>
</template>

<style scoped>
.map-vm {
  position: absolute;
  width: 164px;
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  box-sizing: border-box;
  padding: 4px 6px;
}

/* Matches the red used by every badge's own top tier / error chip — any
   metric on this VM (or on one of its containers) currently reading that
   red is worth noticing from a glance at the whole map, not just up close. */
.map-vm--critical {
  border: 2px solid #b91c1c;
}

.map-vm__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem;
  margin-bottom: 3px;
}

.map-vm__name {
  font-weight: 600;
  font-size: 0.72rem;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.map-vm__role {
  font-size: 0.6rem;
  color: #94a3b8;
  white-space: nowrap;
}

.map-vm__metrics {
  display: flex;
  flex-direction: column;
}

.map-vm__metrics-row {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 14px;
  overflow: hidden;
}

.map-vm__divider {
  height: 1px;
  background: #e2e8f0;
  /* Negative horizontal margin matches .map-vm's own 6px padding, so the
     line reaches the box's edges instead of stopping at the padded area. */
  margin: 5px -6px;
}

.map-vm__containers {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.map-vm__empty {
  font-size: 0.65rem;
  color: #cbd5e1;
  font-style: italic;
}

/* A plain container (no metrics) is just its __header row, so it still
   renders at the same fixed 20px it always has — __backends only adds
   height for containers that actually have something to show (currently
   just haproxy-fronting ones). */
.map-container {
  display: flex;
  flex-direction: column;
  font-size: 0.65rem;
  padding: 0 0.4rem;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  background: #fafafa;
  color: #334155;
  box-sizing: border-box;
}

.map-container__header {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  height: 20px;
}

.map-container__backends {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-bottom: 3px;
}

/* Each backend a container fronts gets its own bordered sub-rectangle —
   same visual language as a container sitting inside its VM — rather than
   being just another row, since a backend is its own distinct thing (a
   haproxy container can front several) with its own set of stats. */
.map-container__backend {
  border: 1px solid #dbe3ea;
  border-radius: 4px;
  background: #fff;
  padding: 2px 4px;
}

.map-container__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #94a3b8;
  flex: none;
}

.map-container__icon {
  width: 11px;
  height: 11px;
  flex: none;
  object-fit: contain;
}

.map-container__label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
