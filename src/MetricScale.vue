<script setup>
// One reading placed on a 0–100 track, with the tiers that give it meaning
// drawn underneath. Shared by the explainer modals; see metricScale.js for
// the shaping that produces a row.
// `row.unit`/`row.decimals` default to a percentage, which most readings
// here are. A row with no `zones` is a reading with no scale to place it on
// — a queue depth, say — and renders as the caption alone.
defineProps({
  row: { type: Object, required: true },
})
</script>

<template>
  <div class="metric-scale">
    <p class="metric-scale__head">
      <span class="metric-scale__label">{{ row.label }}</span>
      <span
        class="metric-scale__value"
        :class="{ 'metric-scale__value--plain': row.chip.plain }"
        :style="row.chip.plain ? null : { color: row.chip.color, background: row.chip.background }"
      >{{ row.value === null ? '—' : `${row.value.toFixed(row.decimals ?? 2)}${row.unit ?? '%'}` }}</span>
    </p>
    <p class="metric-scale__note">{{ row.note }}</p>
    <!-- For a reading that wants its own depiction rather than a track —
         see the disk modal's queue. -->
    <slot />

    <!-- Every bar is the same 0–100 scale, so a metric that normally sits
         near zero reads as the small number it is rather than being blown
         up to fill its own track. -->
    <div v-if="row.zones" class="metric-scale__track">
      <span
        v-if="row.value !== null"
        class="metric-scale__fill"
        :style="{ width: `${Math.min(100, Math.max(0, row.value))}%`, background: row.fill }"
      />
      <!-- Stacked on after the reading rather than added into it: this is a
           second share of the same whole, and the point is that it is NOT
           part of the figure above. -->
      <span
        v-if="row.extra"
        class="metric-scale__fill"
        :style="{ width: `${Math.min(100, Math.max(0, row.extra.value))}%`, background: row.extra.background }"
      />
    </div>

    <!-- The tiers on the same scale directly beneath: the fill says where
         this reading is, the strip says what that place means. -->
    <div v-if="row.zones" class="metric-scale__zones">
      <span
        v-for="zone in row.zones"
        :key="zone.from"
        class="metric-scale__zone"
        :style="{
          width: `${zone.to - zone.from}%`,
          background: zone.background,
          opacity: zone.active ? 1 : 0.3,
        }"
      />
    </div>
    <div v-if="row.zones" class="metric-scale__marks">
      <span
        v-for="mark in row.marks"
        :key="mark"
        class="metric-scale__mark"
        :class="{ 'metric-scale__mark--start': mark === 0, 'metric-scale__mark--end': mark === 100 }"
        :style="{ left: `${mark}%` }"
      >
        {{ mark }}%
      </span>
    </div>
  </div>
</template>

<style scoped>
.metric-scale + .metric-scale {
  margin-top: 1.3rem;
}

.metric-scale__head,
.metric-scale__note {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: #64748b;
}

.metric-scale__label {
  font-weight: 700;
  color: #334155;
}

/* The badge's own chip, at this modal's text size: same weight, padding and
   corner, and the same colour pair the map is painting it with. */
.metric-scale__value {
  margin-left: 0.3rem;
  padding: 1px 5px;
  border-radius: 4px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.metric-scale__value--plain {
  font-weight: 400;
  color: #64748b;
  background: none;
}

/* Fully rounded, like the HUD pills and chips everywhere else. Segments
   inside are square and get their shape from this clipping them, so two
   stacked together meet flush instead of each rounding into the other. */
.metric-scale__track {
  display: flex;
  height: 12px;
  margin-top: 0.45rem;
  border-radius: 999px;
  background: #f1f5f9;
  overflow: hidden;
}

.metric-scale__fill {
  height: 100%;
  transition: width 0.3s ease, background 0.3s ease;
}

.metric-scale__zones {
  display: flex;
  gap: 1px;
  height: 4px;
  margin-top: 3px;
}

.metric-scale__zone:first-child {
  border-radius: 999px 0 0 999px;
}

.metric-scale__zone:last-child {
  border-radius: 0 999px 999px 0;
}

.metric-scale__marks {
  position: relative;
  height: 1rem;
  margin-top: 2px;
}

.metric-scale__mark {
  position: absolute;
  transform: translateX(-50%);
  font-size: 0.65rem;
  font-variant-numeric: tabular-nums;
  color: #94a3b8;
}

.metric-scale__mark::before {
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
.metric-scale__mark--start {
  transform: none;
}

.metric-scale__mark--start::before {
  left: 0;
}

.metric-scale__mark--end {
  transform: translateX(-100%);
}

.metric-scale__mark--end::before {
  left: auto;
  right: 0;
}
</style>
