<script setup>
import { computed } from 'vue'
import UModal from '@nuxt/ui/components/Modal.vue'
import { ramExplainerOpen, ramExplainerContext, closeRamExplainer } from './ramExplainer.js'
import { RAM_BUSY_TIERS, SWAP_THRESHOLD, formatGiB } from './metrics.js'
import { tieredRow, thresholdRow } from './metricScale.js'
import MetricScale from './MetricScale.vue'

const reading = computed(() => ramExplainerContext.value?.data?.value ?? null)

// Page cache as its own share of the same bar rather than folded into the
// figure above — the whole point is that it ISN'T used memory, it's memory
// the kernel is borrowing until something wants it back. Hence the quieter
// grey: it's the larger segment nearly always, and it shouldn't out-shout
// the reading the modal is actually about (see RAM_BUSY_TIERS' healthy bar).
const CACHE_COLOUR = '#cbd5e1'

const usedRow = computed(() => {
  const r = reading.value
  const cachedPercent = r && r.totalBytes ? (r.cachedBytes / r.totalBytes) * 100 : null
  return {
    ...tieredRow(
      'Used',
      r?.busy ?? null,
      RAM_BUSY_TIERS,
      'Memory in use, not counting cache Linux hands back the moment anything needs it.'
    ),
    extra: cachedPercent === null ? null : { value: cachedPercent, background: CACHE_COLOUR },
  }
})

const swapRow = computed(() =>
  thresholdRow(
    'swap',
    reading.value?.swapPercent ?? null,
    SWAP_THRESHOLD,
    'Swapping at all means real memory pressure, not just a box that looks full.'
  )
)

const title = computed(() =>
  ramExplainerContext.value ? `Memory · ${ramExplainerContext.value.resourceId}` : 'Memory metrics'
)
</script>

<template>
  <UModal :open="ramExplainerOpen" :title="title" @update:open="(v) => !v && closeRamExplainer()">
    <template #body>
      <MetricScale :row="usedRow" />
      <!-- Directly under the bar it describes: these are the figures those
           segments are, and the dots say which is which. -->
      <p v-if="reading && reading.totalBytes" class="ram-explainer__breakdown">
        <span class="ram-explainer__dot" :style="{ background: usedRow.fill }" />{{ formatGiB(reading.usedBytes, 2) }} GB used
        <span class="ram-explainer__sep">·</span>
        <span class="ram-explainer__dot" :style="{ background: CACHE_COLOUR }" />{{ formatGiB(reading.cachedBytes, 2) }} GB cached
        <span class="ram-explainer__sep">·</span>
        {{ formatGiB(reading.totalBytes, 2) }} GB total
      </p>
      <MetricScale :row="swapRow" />
      <p class="ram-explainer__source">
        VMs: node_exporter. Servers: collectd. Cache, buffers and reclaimable slab count as available
        on both, so the two read the same way.
      </p>
    </template>
  </UModal>
</template>

<style scoped>
/* The same three figures the badge shows, with the two coloured ones keyed
   to their segment in the bar above. */
.ram-explainer__breakdown {
  margin: 0.5rem 0 1.3rem;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  color: #334155;
}

.ram-explainer__dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 0.3rem;
  border-radius: 999px;
  vertical-align: baseline;
}

.ram-explainer__sep {
  margin: 0 0.15rem;
  color: #cbd5e1;
}

.ram-explainer__source {
  margin: 1.2rem 0 0;
  font-size: 0.7rem;
  color: #94a3b8;
}
</style>
