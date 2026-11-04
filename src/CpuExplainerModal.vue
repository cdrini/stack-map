<script setup>
import { computed } from 'vue'
import UModal from '@nuxt/ui/components/Modal.vue'
import { cpuExplainerOpen, cpuExplainerContext, closeCpuExplainer } from './cpuExplainer.js'
import { CPU_BUSY_TIERS, CPU_STEAL_TIERS, WAIT_THRESHOLD } from './metrics.js'

// Whatever the badge that opened this is currently showing. Null when it was
// opened from the right-click menu instead, which has no reading to pass —
// the bars then explain the thresholds on their own.
const reading = computed(() => cpuExplainerContext.value?.data?.value ?? null)

// Solid enough to read against white, unlike the chip tints (see the bar
// colours on CPU_BUSY_TIERS).
const CALM_BAR = '#cbd5e1'
const WARN_BAR = '#fb923c'

// The thresholds are the marks under the track, and the tier a reading
// currently sits in is what colours its fill — both taken from the tables
// that colour the badge, so neither can drift from what's being applied.
function zonesFromTiers(tiers) {
  return tiers.map((tier, i) => ({
    from: i === 0 ? 0 : tiers[i - 1].max,
    to: tier.max === Infinity ? 100 : tier.max,
    background: tier.bar,
  }))
}

function zonesFromThreshold(threshold) {
  return [
    { from: 0, to: threshold, background: CALM_BAR },
    { from: threshold, to: 100, background: WARN_BAR },
  ]
}

// Only the band the reading currently falls in is shown at full strength;
// the rest stay faint, so the strip answers "which tier am I in" at a
// glance instead of being four equally loud colours. With no reading to
// place (opened from the right-click menu), the whole strip is just a
// legend, so none of it is dimmed.
function markActive(zones, value) {
  if (value === null) return zones.map((zone) => ({ ...zone, active: true }))
  const hit = zones.find((zone) => value < zone.to) ?? zones.at(-1)
  return zones.map((zone) => ({ ...zone, active: zone === hit }))
}

// Thresholds plus the ends of the scale, so the strip is read against a
// labelled 0–100 range rather than three numbers floating in it.
function marksWithEnds(thresholds) {
  return [0, ...thresholds, 100]
}

function tierFor(tiers, value) {
  return tiers.find((tier) => value < tier.max) ?? tiers.at(-1)
}

// A metric whose scale is a tier table: the marks are its boundaries, the
// fill takes the colour of the band the reading lands in, and the chip is
// that band's badge colours.
function tieredRow(label, value, tiers, note) {
  const tier = value === null ? null : tierFor(tiers, value)
  return row({
    label,
    value,
    marks: marksWithEnds(tiers.slice(0, -1).map((t) => t.max)),
    zones: zonesFromTiers(tiers),
    fill: tier?.bar ?? CALM_BAR,
    chip: tier && !tier.plain ? { color: tier.color, background: tier.background } : PLAIN_CHIP,
    note,
  })
}

// The same colour pair the badge paints this reading with, so the figure in
// here and the figure on the map are recognisably the same chip. `plain` is
// the healthy tier, which the badge deliberately leaves uncoloured.
const PLAIN_CHIP = { plain: true }
const WARN_CHIP = { color: '#9a3412', background: '#ffedd5' }

function row({ label, value, marks, zones, fill, chip, note }) {
  return {
    label,
    value,
    marks,
    zones: markActive(zones, value),
    fill,
    chip: value === null ? PLAIN_CHIP : chip,
    note,
  }
}

const rows = computed(() => {
  const r = reading.value
  const wait = r?.wait ?? null
  const waitElevated = wait !== null && wait > WAIT_THRESHOLD
  return [
    tieredRow('Busy', r?.busy ?? null, CPU_BUSY_TIERS, "Share of time the CPU wasn't idle, whatever the core count."),
    row({
      label: 'wait',
      value: wait,
      marks: marksWithEnds([WAIT_THRESHOLD]),
      zones: zonesFromThreshold(WAIT_THRESHOLD),
      fill: waitElevated ? WARN_BAR : CALM_BAR,
      chip: waitElevated ? WARN_CHIP : PLAIN_CHIP,
      note: 'Waiting on disk or network — busy, but more CPU wouldn\u2019t help.',
    }),
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
      <div v-for="row in rows" :key="row.label" class="cpu-explainer__row">
        <p class="cpu-explainer__head">
          <span class="cpu-explainer__label">{{ row.label }}</span>
          <span
            class="cpu-explainer__value"
            :class="{ 'cpu-explainer__value--plain': row.chip.plain }"
            :style="row.chip.plain ? null : { color: row.chip.color, background: row.chip.background }"
          >{{ row.value === null ? '—' : `${row.value.toFixed(2)}%` }}</span>
        </p>
        <p class="cpu-explainer__note">{{ row.note }}</p>

        <!-- Every bar is the same 0–100 scale, so wait and steal read as the
             small numbers they usually are rather than being blown up to
             fill their own track. -->
        <div class="cpu-explainer__track">
          <span
            v-if="row.value !== null"
            class="cpu-explainer__fill"
            :style="{ width: `${Math.min(100, Math.max(0, row.value))}%`, background: row.fill }"
          />
        </div>
        <!-- The tiers themselves, on the same scale directly beneath the
             meter: the fill says where this reading is, the strip says what
             that place means. -->
        <div class="cpu-explainer__zones">
          <span
            v-for="zone in row.zones"
            :key="zone.from"
            class="cpu-explainer__zone"
            :style="{
              width: `${zone.to - zone.from}%`,
              background: zone.background,
              opacity: zone.active ? 1 : 0.3,
            }"
          />
        </div>
        <div class="cpu-explainer__marks">
          <span v-for="mark in row.marks" :key="mark" class="cpu-explainer__mark" :style="{ left: `${mark}%` }">
            {{ mark }}%
          </span>
        </div>
      </div>
      <p class="cpu-explainer__source">VMs: node_exporter, averaged over 2 minutes. Servers: collectd.</p>
    </template>
  </UModal>
</template>

<style scoped>
.cpu-explainer__row + .cpu-explainer__row {
  margin-top: 1.3rem;
}

.cpu-explainer__head {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: #64748b;
}

.cpu-explainer__note {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: #64748b;
}

.cpu-explainer__label {
  font-size: 0.8rem;
  font-weight: 700;
  color: #334155;
}

/* The badge's own chip, at this modal's text size: same weight, padding and
   corner, and the same colour pair the map is painting it with. */
.cpu-explainer__value {
  margin-left: 0.3rem;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.cpu-explainer__value--plain {
  font-weight: 400;
  color: #64748b;
  background: none;
}

/* Fully rounded, like the HUD pills and chips everywhere else. */
.cpu-explainer__track {
  height: 12px;
  margin-top: 0.45rem;
  border-radius: 999px;
  background: #f1f5f9;
  overflow: hidden;
}

.cpu-explainer__fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s ease, background 0.3s ease;
}

/* The thresholds, placed on the same scale as the fill rather than written
   out in the text — so "where am I" and "where does this get bad" are the
   same glance. */
.cpu-explainer__zones {
  display: flex;
  gap: 1px;
  height: 4px;
  margin-top: 3px;
}

.cpu-explainer__zone:first-child {
  border-radius: 999px 0 0 999px;
}

.cpu-explainer__zone:last-child {
  border-radius: 0 999px 999px 0;
}

.cpu-explainer__marks {
  position: relative;
  height: 1rem;
  margin-top: 2px;
}

.cpu-explainer__mark {
  position: absolute;
  transform: translateX(-50%);
  font-size: 0.65rem;
  font-variant-numeric: tabular-nums;
  color: #94a3b8;
}

.cpu-explainer__mark::before {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 100%;
  width: 1px;
  height: 3px;
  background: #cbd5e1;
}

/* The two ends sit flush with the track rather than centred on it, so
   neither label hangs off the side of the bar it belongs to. */
.cpu-explainer__mark:first-child {
  transform: none;
}

.cpu-explainer__mark:first-child::before {
  left: 0;
}

.cpu-explainer__mark:last-child {
  transform: translateX(-100%);
}

.cpu-explainer__mark:last-child::before {
  left: auto;
  right: 0;
}

.cpu-explainer__source {
  margin: 1.2rem 0 0;
  font-size: 0.7rem;
  color: #94a3b8;
}
</style>
