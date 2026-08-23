<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { metricsFor } from './spec.js'
import { appFor } from './apps.js'
import {
  partitionMetricFamilies,
  groupDiskMetricsByDisk,
  groupHaproxyMetricsByBackend,
  groupSolrMetricsByHandler,
} from './metrics.js'
import { containerMenuItems } from './containerMenu.js'
import { vmMenuItems } from './vmMenu.js'
import UContextMenu from '@nuxt/ui/components/ContextMenu.vue'
import MetricBadge from './MetricBadge.vue'
import CpuBadge from './CpuBadge.vue'
import MemBadge from './MemBadge.vue'
import DiskBadge from './DiskBadge.vue'
import HaproxyBadge from './HaproxyBadge.vue'
import SolrBadge from './SolrBadge.vue'

const props = defineProps({
  vm: { type: Object, required: true },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  // The hovered container (elsewhere on the map, possibly this box) plus
  // everything it has a direct relationship with — null when nothing's
  // hovered, meaning no dimming. See MapView.vue's attachedContainerIds.
  attachedContainerIds: { type: Set, default: null },
})

const emit = defineEmits(['recheck-size', 'hover-container'])

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

// A container can carry its own metrics too (haproxy-*/solr-*, see
// stack.yaml) — unlike the VM-level families above, these are specific to
// one container, so they're keyed by container id rather than being a
// single flat list.
const containerFamiliesById = computed(() =>
  Object.fromEntries(
    props.vm.containers.map((c) => [c.id, partitionMetricFamilies(metricsFor(c, 'container'))])
  )
)
const haproxyGroupsByContainer = computed(() =>
  Object.fromEntries(
    props.vm.containers.map((c) => [c.id, groupHaproxyMetricsByBackend(containerFamiliesById.value[c.id].haproxyMetrics)])
  )
)
const solrGroupsByContainer = computed(() =>
  Object.fromEntries(
    props.vm.containers.map((c) => [c.id, groupSolrMetricsByHandler(containerFamiliesById.value[c.id].solrMetrics)])
  )
)
const otherMetricsByContainer = computed(() =>
  Object.fromEntries(props.vm.containers.map((c) => [c.id, containerFamiliesById.value[c.id].otherMetrics]))
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
  const haproxyBadges = Object.values(haproxyGroupsByContainer.value).reduce((sum, groups) => sum + groups.length, 0)
  const solrBadges = Object.values(solrGroupsByContainer.value).reduce((sum, groups) => sum + groups.length, 0)
  const otherBadges = Object.values(otherMetricsByContainer.value).reduce((sum, metrics) => sum + metrics.length, 0)
  return vmBadges + haproxyBadges + solrBadges + otherBadges
})
let settledCount = 0
let hasEmittedSettled = false
function checkAllSettled() {
  if (hasEmittedSettled || settledCount < totalBadges.value) return
  hasEmittedSettled = true
  emit('recheck-size', props.vm.id)
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

// Dims the whole box, not just its containers, once none of them are
// attached to whatever's hovered — including a VM with no containers at
// all, which is equally unrelated. `every` is vacuously true for an empty
// list, so that case falls out for free. Short-circuits to a falsy null
// (not true) when nothing's hovered, since attachedContainerIds is null then.
const allContainersDimmed = computed(
  () => props.attachedContainerIds && props.vm.containers.every((c) => !props.attachedContainerIds.has(c.id))
)

// Same Map-of-keys pattern as criticalStatuses, for solr handler rows that
// report themselves empty (see SolrBadge.vue's `isEmpty`) — `v-show`, not
// `v-if`, on the row in the template so hiding one doesn't unmount (and
// re-fetch) the badge, just collapses its space; the badge keeps polling
// in the background in case it stops being empty later.
const emptyHandlers = ref(new Map())
function setHandlerEmpty(key, isEmptyValue) {
  const wasEmpty = emptyHandlers.value.has(key)
  if (wasEmpty === isEmptyValue) return
  const next = new Map(emptyHandlers.value)
  if (isEmptyValue) next.set(key, true)
  else next.delete(key)
  emptyHandlers.value = next
  // A row appearing/disappearing on a LATER refresh (not just the first
  // load) changes this box's real height just as much as the first-load
  // case does — measuredSizes only ever got corrected once, on first
  // settle, so without this an edge could keep pointing at a container's
  // old position after its box grew or shrank. nextTick so the DOM has
  // actually applied the v-show flip before anyone re-measures.
  if (hasEmittedSettled) {
    nextTick(() => emit('recheck-size', props.vm.id))
  }
}

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
  <UContextMenu :items="vmMenuItems(vm)" size="sm">
  <div
    ref="rootEl"
    class="map-vm"
    :class="{ 'map-vm--critical': hasCriticalMetric, 'map-vm--dimmed': allContainersDimmed }"
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
      <UContextMenu
        v-for="c in vm.containers"
        :key="c.id"
        :items="containerMenuItems(c)"
        size="sm"
      >
      <div
        :ref="(el) => setContainerEl(c.id, el)"
        class="map-container"
        :class="{ 'map-container--dimmed': attachedContainerIds && !attachedContainerIds.has(c.id) }"
        @mouseenter="emit('hover-container', c.id)"
        @mouseleave="emit('hover-container', null)"
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
          <span v-if="c.replicas" class="map-container__replicas" :title="`${c.replicas} replicas`">x{{ c.replicas }}</span>
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
        <div v-if="solrGroupsByContainer[c.id].length" class="map-container__metrics">
          <div
            v-for="group in solrGroupsByContainer[c.id]"
            v-show="!emptyHandlers.get(c.id + ':' + group.handler)"
            :key="'solr-' + group.handler"
            class="map-container__metrics-row"
          >
            <SolrBadge
              :metrics="group.metrics"
              :handler="group.handler"
              :resource-id="c.id"
              @settled="onBadgeSettled"
              @empty-change="(v) => setHandlerEmpty(c.id + ':' + group.handler, v)"
            />
          </div>
        </div>
        <div v-if="otherMetricsByContainer[c.id].length" class="map-container__metrics">
          <div v-for="metric in otherMetricsByContainer[c.id]" :key="metric.type" class="map-container__metrics-row">
            <MetricBadge :metric="metric" :resource-id="c.id" @settled="onBadgeSettled" />
          </div>
        </div>
      </div>
      </UContextMenu>
    </div>
    <div v-else class="map-vm__empty">no containers</div>
  </div>
  </UContextMenu>
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
  transition: opacity 0.15s;
}

/* Matches the red used by every badge's own top tier / error chip — any
   metric on this VM (or on one of its containers) currently reading that
   red is worth noticing from a glance at the whole map, not just up close. */
.map-vm--critical {
  border: 2px solid #b91c1c;
}

/* Compounds with any still-dimmed .map-container--dimmed children inside
   (opacity multiplies down the tree), which is fine here — a VM with
   nothing attached to the hovered container is meant to all but disappear. */
.map-vm--dimmed {
  opacity: 0.3;
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
  padding: 0 3px;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  background: #fafafa;
  color: #334155;
  box-sizing: border-box;
  transition: opacity 0.15s;
}

.map-container--dimmed {
  opacity: 0.3;
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

/* Plain rows for a container's metrics that don't split into distinct
   sub-resources (solr-*, custom) — no bordered box, just another row,
   same idea as .map-vm__metrics-row. */
.map-container__metrics {
  display: flex;
  flex-direction: column;
  padding-bottom: 3px;
}

/* min-height (not a hard height + overflow:hidden) — a badge in here can
   need a second line (see SolrBadge.vue's error/timeout row), and the box
   is measured from real DOM geometry rather than assumed, so there's
   nothing to clip against. */
.map-container__metrics-row {
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 14px;
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

.map-container__replicas {
  flex: none;
  margin-left: auto;
  font-size: 0.55rem;
  font-weight: 700;
  color: #64748b;
  background: #e2e8f0;
  padding: 1px 4px;
  border-radius: 4px;
}
</style>
