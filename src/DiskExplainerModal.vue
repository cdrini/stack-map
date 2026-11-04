<script setup>
import { computed } from 'vue'
import UModal from '@nuxt/ui/components/Modal.vue'
import { diskExplainerOpen, diskExplainerContext, closeDiskExplainer } from './diskExplainer.js'
import { DISK_BUSY_TIERS, DISK_FILL_TIERS, PENDING_THRESHOLD, LOW_SPACE_BYTES, formatGiB } from './metrics.js'
import { tieredRow, PLAIN_CHIP, WARN_CHIP, CALM_BAR, WARN_BAR } from './metricScale.js'
import MetricScale from './MetricScale.vue'

const reading = computed(() => diskExplainerContext.value?.data?.value ?? null)

const fillRow = computed(() =>
  tieredRow('Fill', reading.value?.fill ?? null, DISK_FILL_TIERS, "How full this disk's filesystem is.")
)

const busyRow = computed(() =>
  tieredRow(
    'Busy',
    reading.value?.busy ?? null,
    DISK_BUSY_TIERS,
    'Share of each second spent servicing I/O — what iostat calls %util.'
  )
)

// Queue depth is a count, not a share of anything, so it has no track to sit
// on; it's a caption with a chip that lights up past the same threshold the
// badge uses.
const pendingRow = computed(() => {
  const pending = reading.value?.pending ?? null
  return {
    label: 'pending',
    value: pending,
    unit: '',
    decimals: 0,
    chip: pending !== null && pending > PENDING_THRESHOLD ? WARN_CHIP : PLAIN_CHIP,
    note: "Requests queued rather than completing. A blip is normal; sustained means the disk can't keep up.",
  }
})

// One block per queued request, rather than a bar: the number is small and
// discrete, so showing the actual count reads faster than a length does —
// and a queue two deep looking twice a queue one deep is exactly right.
// It scrolls rather than wrapping, so the blocks stay on one line and the
// scale underneath them stays meaningful.
const QUEUE_BLOCK = 8 // px
const QUEUE_GAP = 3 // px
const QUEUE_PITCH = QUEUE_BLOCK + QUEUE_GAP
// Generous, but a runaway queue shouldn't render thousands of elements.
const MAX_QUEUE_BLOCKS = 240

const queue = computed(() => {
  const pending = reading.value?.pending ?? null
  if (pending === null) return null
  const count = Math.max(0, Math.round(pending))
  const blocks = Math.min(count, MAX_QUEUE_BLOCKS)

  // The only mark worth making is the line itself — the blocks already
  // count themselves, so round numbers along the axis say nothing a reader
  // can't see. It sits in the gap after the last unremarkable block, which
  // is where "above N" actually falls.
  const boundary = PENDING_THRESHOLD * QUEUE_PITCH - QUEUE_GAP / 2
  const elevated = count > PENDING_THRESHOLD

  return {
    blocks,
    boundary,
    // One colour for the whole queue, decided by the threshold: a queue
    // that hasn't crossed the line shouldn't look like one that has.
    blockColour: elevated ? WARN_BAR : CALM_BAR,
    // Wide enough for the blocks, but never narrower than the space
    // available — the scale is worth reading even when the queue is short,
    // and a two-block strip is too small to show a threshold on.
    minWidth: Math.max(0, blocks * QUEUE_PITCH - QUEUE_GAP),
    elevated,
    overflow: Math.max(0, count - MAX_QUEUE_BLOCKS),
  }
})

const lowSpace = computed(
  () => reading.value?.availBytes !== null && reading.value?.availBytes < LOW_SPACE_BYTES
)

const title = computed(() => {
  const context = diskExplainerContext.value
  if (!context) return 'Disk metrics'
  return `Disk · ${context.resourceId}${context.disk ? ` ${context.disk}` : ''}`
})
</script>

<template>
  <UModal :open="diskExplainerOpen" :title="title" @update:open="(v) => !v && closeDiskExplainer()">
    <template #body>
      <MetricScale :row="fillRow" />
      <!-- The bytes behind the percentage above, and the one number worth
           reacting to: free space, red once it's low enough that writes
           start failing. -->
      <p v-if="reading && reading.totalBytes" class="disk-explainer__breakdown">
        <span class="disk-explainer__dot" :style="{ background: CALM_BAR }" />{{ formatGiB(reading.usedBytes, 2) }} GB used
        <span class="disk-explainer__sep">·</span>
        <span :class="{ 'disk-explainer__low': lowSpace }">{{ formatGiB(reading.availBytes, 2) }} GB free</span>
        <span class="disk-explainer__sep">·</span>
        {{ formatGiB(reading.totalBytes, 2) }} GB total
      </p>

      <MetricScale :row="busyRow" />
      <MetricScale :row="pendingRow">
        <!-- Rendered whenever there's a reading at all, blocks or not: an
             empty track is the answer "nothing is queued", which is worth
             seeing as much as a full one. -->
        <div v-if="queue" class="disk-explainer__queue">
          <div class="disk-explainer__queue-scroll">
            <div class="disk-explainer__queue-inner" :style="{ minWidth: `${queue.minWidth}px` }">
              <div class="disk-explainer__queue-blocks">
                <span
                  v-for="n in queue.blocks"
                  :key="n"
                  class="disk-explainer__queue-block"
                  :style="{ background: queue.blockColour }"
                />
              </div>
              <!-- The strip runs the whole width whatever the queue length,
                   with the threshold a fixed distance in — so where the line
                   sits is readable at two blocks as well as at fifty. -->
              <div class="disk-explainer__queue-zones">
                <span
                  class="disk-explainer__queue-zone"
                  :style="{
                    width: `${queue.boundary}px`,
                    background: CALM_BAR,
                    opacity: queue.elevated ? 0.3 : 1,
                  }"
                />
                <span
                  class="disk-explainer__queue-zone disk-explainer__queue-zone--rest"
                  :style="{ background: WARN_BAR, opacity: queue.elevated ? 1 : 0.3 }"
                />
              </div>
              <div class="disk-explainer__queue-marks">
                <span class="disk-explainer__queue-mark" :style="{ left: `${queue.boundary}px` }">{{
                  PENDING_THRESHOLD
                }}</span>
              </div>
            </div>
          </div>
          <span v-if="queue.overflow" class="disk-explainer__queue-more">+{{ queue.overflow }}</span>
        </div>
      </MetricScale>

      <p class="disk-explainer__source">
        Capacity from node_exporter, I/O from collectd. Free space turns red under
        {{ formatGiB(LOW_SPACE_BYTES, 0) }}GB, the point where writes start failing.
      </p>
    </template>
  </UModal>
</template>

<style scoped>
.disk-explainer__breakdown {
  margin: 0.5rem 0 1.3rem;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  color: #334155;
}

.disk-explainer__dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 0.3rem;
  border-radius: 999px;
  vertical-align: baseline;
}

.disk-explainer__sep {
  margin: 0 0.15rem;
  color: #cbd5e1;
}

.disk-explainer__low {
  font-weight: 700;
  color: #b91c1c;
}

/* Scrolls rather than wrapping: the blocks are a line with a scale under
   them, and a wrapped line has no single axis to label. */
.disk-explainer__queue {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  margin-top: 0.45rem;
}

.disk-explainer__queue-scroll {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}

.disk-explainer__queue-inner {
  position: relative;
}

.disk-explainer__queue-blocks {
  display: flex;
  gap: 3px;
  /* Keeps its height with nothing in it, so the track doesn't jump up the
     moment the queue empties. */
  min-height: 12px;
}

.disk-explainer__queue-block {
  flex: none;
  width: 8px;
  height: 12px;
  border-radius: 2px;
}

/* Same strip the metric scales carry, measured in blocks instead of
   percent. */
.disk-explainer__queue-zones {
  display: flex;
  gap: 1px;
  height: 4px;
  margin-top: 3px;
}

.disk-explainer__queue-zone--rest {
  flex: 1;
}

.disk-explainer__queue-zone:first-child {
  border-radius: 999px 0 0 999px;
}

.disk-explainer__queue-zone:last-child {
  border-radius: 0 999px 999px 0;
}

.disk-explainer__queue-marks {
  position: relative;
  height: 1rem;
  margin-top: 2px;
}

.disk-explainer__queue-mark {
  position: absolute;
  transform: translateX(-50%);
  font-size: 0.65rem;
  font-variant-numeric: tabular-nums;
  color: #94a3b8;
}

.disk-explainer__queue-mark::before {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 100%;
  width: 1px;
  height: 3px;
  background: #cbd5e1;
}

.disk-explainer__queue-more {
  margin-top: 1px;
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
  color: #94a3b8;
}

.disk-explainer__source {
  margin: 1.2rem 0 0;
  font-size: 0.7rem;
  color: #94a3b8;
}
</style>
