<script setup>
import { computed } from 'vue'
import UModal from '@nuxt/ui/components/Modal.vue'
import { cpuExplainerOpen, cpuExplainerContext, closeCpuExplainer } from './cpuExplainer.js'
import { CPU_BUSY_TIERS, CPU_STEAL_TIERS, WAIT_THRESHOLD } from './metrics.js'
import { tieredRow, thresholdRow } from './metricScale.js'
import MetricScale from './MetricScale.vue'

// Whatever the badge that opened this is currently showing. Null when it was
// opened from the right-click menu instead, which has no reading to pass —
// the bars then explain the thresholds on their own.
const reading = computed(() => cpuExplainerContext.value?.data?.value ?? null)

const rows = computed(() => {
  const r = reading.value
  return [
    tieredRow('Busy', r?.busy ?? null, CPU_BUSY_TIERS, "Share of time the CPU wasn't idle, whatever the core count."),
    thresholdRow(
      'wait',
      r?.wait ?? null,
      WAIT_THRESHOLD,
      'Waiting on disk or network — busy, but more CPU wouldn’t help.'
    ),
    tieredRow(
      'steal',
      r?.steal ?? null,
      CPU_STEAL_TIERS,
      'The hypervisor gave the CPU to another VM; the host is oversubscribed.'
    ),
  ]
})

const title = computed(() =>
  cpuExplainerContext.value ? `CPU · ${cpuExplainerContext.value.resourceId}` : 'CPU metrics'
)
</script>

<template>
  <UModal :open="cpuExplainerOpen" :title="title" @update:open="(v) => !v && closeCpuExplainer()">
    <template #body>
      <MetricScale v-for="row in rows" :key="row.label" :row="row" />
      <p class="cpu-explainer__source">VMs: node_exporter, averaged over 2 minutes. Servers: collectd.</p>
    </template>
  </UModal>
</template>

<style scoped>
.cpu-explainer__source {
  margin: 1.2rem 0 0;
  font-size: 0.7rem;
  color: #94a3b8;
}
</style>
