<script setup>
// Standalone top-level rendering of a single container — the "Group by
// VM" toggle's counterpart to VmBox.vue, which renders a container's
// markup nested inside its VM's box instead. Deliberately a separate
// component rather than something VmBox also delegates to: the two need
// different lifecycles (this one is independently positioned/measured on
// the map; VmBox's containers are laid out in normal document flow inside
// it) for what would otherwise be a fairly small amount of shared markup.
import { computed, nextTick, onMounted, ref } from 'vue'
import { metricsFor } from './spec.js'
import { appFor } from './apps.js'
import { partitionMetricFamilies, groupHaproxyMetricsByBackend, groupSolrMetricsByHandler } from './metrics.js'
import { stackMenuItems } from './stackMenu.js'
import UContextMenu from '@nuxt/ui/components/ContextMenu.vue'
import HaproxyBadge from './HaproxyBadge.vue'
import SolrBadge from './SolrBadge.vue'
import MetricBadge from './MetricBadge.vue'

const props = defineProps({
  container: { type: Object, required: true },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  // See VmBox.vue's own copy of this prop.
  attachedContainerIds: { type: Set, default: null },
})

const emit = defineEmits(['recheck-size', 'hover-container'])

const families = computed(() => partitionMetricFamilies(metricsFor(props.container, 'container')))
const haproxyGroups = computed(() => groupHaproxyMetricsByBackend(families.value.haproxyMetrics))
const solrGroups = computed(() => groupSolrMetricsByHandler(families.value.solrMetrics))
const otherMetrics = computed(() => families.value.otherMetrics)

// Same idea as VmBox.vue's totalBadges/checkAllSettled, scoped to just this
// one container's own badges rather than a whole VM's worth.
const totalBadges = computed(() => haproxyGroups.value.length + solrGroups.value.length + otherMetrics.value.length)
let settledCount = 0
let hasEmittedSettled = false
function checkAllSettled() {
  if (hasEmittedSettled || settledCount < totalBadges.value) return
  hasEmittedSettled = true
  emit('recheck-size', props.container.id)
}
function onBadgeSettled() {
  settledCount++
  checkAllSettled()
}
onMounted(checkAllSettled) // handles the zero-badges case, where nothing else would ever call this

// Same Map-of-keys pattern as VmBox.vue's criticalStatuses, but driving
// this container's own border directly rather than aggregating up into a
// parent VM's.
const criticalStatuses = ref(new Map())
function setCritical(key, isCritical) {
  const next = new Map(criticalStatuses.value)
  if (isCritical) next.set(key, true)
  else next.delete(key)
  criticalStatuses.value = next
}
const hasCriticalMetric = computed(() => criticalStatuses.value.size > 0)

const emptyHandlers = ref(new Map())
function setHandlerEmpty(key, isEmptyValue) {
  const wasEmpty = emptyHandlers.value.has(key)
  if (wasEmpty === isEmptyValue) return
  const next = new Map(emptyHandlers.value)
  if (isEmptyValue) next.set(key, true)
  else next.delete(key)
  emptyHandlers.value = next
  if (hasEmittedSettled) {
    nextTick(() => emit('recheck-size', props.container.id))
  }
}

const rootEl = ref(null)

function measure(scale = 1) {
  const box = rootEl.value.getBoundingClientRect()
  return { width: box.width / scale, height: box.height / scale }
}

defineExpose({ measure })
</script>

<template>
  <UContextMenu :items="stackMenuItems(container, 'container')" size="sm">
  <div
    ref="rootEl"
    class="map-container-node"
    :class="{
      'map-container-node--critical': hasCriticalMetric,
      'map-container-node--dimmed': attachedContainerIds && !attachedContainerIds.has(container.id),
    }"
    :style="{ left: x + 'px', top: y + 'px' }"
    @mouseenter="emit('hover-container', container.id)"
    @mouseleave="emit('hover-container', null)"
  >
    <div class="map-container-node__header" :title="container.role || container.image">
      <img
        v-if="appFor(container.application)?.icon"
        class="map-container-node__icon"
        :src="appFor(container.application).icon"
        :alt="appFor(container.application).label"
      />
      <span v-else class="map-container-node__dot" />
      <span class="map-container-node__label">{{ container.image }}</span>
      <span
        v-if="container.replicas"
        class="map-container-node__replicas"
        :title="`${container.replicas} replicas`"
      >
        x{{ container.replicas }}
      </span>
    </div>
    <div class="map-container-node__host">on {{ container.hostedOn }}</div>

    <div v-if="haproxyGroups.length" class="map-container-node__backends">
      <div v-for="group in haproxyGroups" :key="'haproxy-' + group.backend" class="map-container-node__backend">
        <HaproxyBadge
          :metrics="group.metrics"
          :backend="group.backend"
          :resource-id="container.id"
          @settled="onBadgeSettled"
          @critical-change="(v) => setCritical('haproxy:' + group.backend, v)"
        />
      </div>
    </div>
    <div v-if="solrGroups.length" class="map-container-node__metrics">
      <div
        v-for="group in solrGroups"
        v-show="!emptyHandlers.get(group.handler)"
        :key="'solr-' + group.handler"
        class="map-container-node__metrics-row"
      >
        <SolrBadge
          :metrics="group.metrics"
          :handler="group.handler"
          :resource-id="container.id"
          @settled="onBadgeSettled"
          @empty-change="(v) => setHandlerEmpty(group.handler, v)"
        />
      </div>
    </div>
    <div v-if="otherMetrics.length" class="map-container-node__metrics">
      <div v-for="metric in otherMetrics" :key="metric.type" class="map-container-node__metrics-row">
        <MetricBadge :metric="metric" :resource-id="container.id" @settled="onBadgeSettled" />
      </div>
    </div>
  </div>
  </UContextMenu>
</template>

<style scoped>
.map-container-node {
  position: absolute;
  width: 164px;
  display: flex;
  flex-direction: column;
  font-size: 0.65rem;
  padding: 4px 6px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  background: #fafafa;
  color: #334155;
  box-sizing: border-box;
  transition: opacity 0.15s;
}

.map-container-node--critical {
  border: 2px solid #b91c1c;
}

.map-container-node--dimmed {
  opacity: 0.3;
}

.map-container-node__header {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  height: 20px;
}

.map-container-node__host {
  font-size: 0.58rem;
  color: #94a3b8;
  margin: -2px 0 2px;
}

.map-container-node__backends {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-bottom: 3px;
}

.map-container-node__backend {
  border: 1px solid #dbe3ea;
  border-radius: 4px;
  background: #fff;
  padding: 2px 4px;
}

.map-container-node__metrics {
  display: flex;
  flex-direction: column;
  padding-bottom: 3px;
}

.map-container-node__metrics-row {
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 14px;
}

.map-container-node__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #94a3b8;
  flex: none;
}

.map-container-node__icon {
  width: 11px;
  height: 11px;
  flex: none;
  object-fit: contain;
}

.map-container-node__label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.map-container-node__replicas {
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
