// Shared shaping for the explainer modals' scales (see MetricScale.vue).
// A row is a reading placed on a 0–100 track, with the tiers that give it
// meaning drawn underneath — every number here comes from the same tables
// that colour the badges, so a modal can't describe thresholds the map
// isn't applying.

// Solid enough to read against white, unlike the chip tints, which are
// backgrounds for dark text rather than blocks of colour in their own right.
export const CALM_BAR = '#cbd5e1'
export const WARN_BAR = '#fb923c'

export const PLAIN_CHIP = { plain: true }
export const WARN_CHIP = { color: '#9a3412', background: '#ffedd5' }

export function zonesFromTiers(tiers) {
  return tiers.map((tier, i) => ({
    from: i === 0 ? 0 : tiers[i - 1].max,
    to: tier.max === Infinity ? 100 : tier.max,
    background: tier.bar,
  }))
}

export function zonesFromThreshold(threshold) {
  return [
    { from: 0, to: threshold, background: CALM_BAR },
    { from: threshold, to: 100, background: WARN_BAR },
  ]
}

// Thresholds plus the ends of the scale, so the strip is read against a
// labelled range rather than a few numbers floating in it — except where an
// end would land on top of a threshold, which happens whenever a threshold
// sits near either extreme (swap's 1%, RAM's 95%). The end is the one
// dropped: a track's start and finish are obvious from the track, while a
// threshold is the thing the strip exists to show.
const MIN_LABEL_GAP = 8 // % of the track; a label is roughly 6% of it wide

export function marksWithEnds(thresholds) {
  const nearest = (end) => Math.min(...thresholds.map((t) => Math.abs(t - end)))
  return [
    ...(nearest(0) >= MIN_LABEL_GAP ? [0] : []),
    ...thresholds,
    ...(nearest(100) >= MIN_LABEL_GAP ? [100] : []),
  ]
}

// Only the band the reading falls in is shown at full strength; the rest
// stay faint, so the strip answers "which tier am I in" at a glance instead
// of being four equally loud colours. With no reading to place, the whole
// strip is just a legend, so none of it is dimmed.
function markActive(zones, value) {
  if (value === null) return zones.map((zone) => ({ ...zone, active: true }))
  const hit = zones.find((zone) => value < zone.to) ?? zones.at(-1)
  return zones.map((zone) => ({ ...zone, active: zone === hit }))
}

function tierFor(tiers, value) {
  return tiers.find((tier) => value < tier.max) ?? tiers.at(-1)
}

function row({ label, value, marks, zones, fill, chip, note }) {
  return { label, value, marks, zones: markActive(zones, value), fill, chip, note }
}

// A metric whose scale is a tier table: the marks are its boundaries, the
// fill takes the colour of the band the reading lands in, and the chip is
// that band's badge colours.
export function tieredRow(label, value, tiers, note) {
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

// A metric with one line in it rather than a curve — below is unremarkable,
// above is worth a call-out, which is exactly what its badge does too.
export function thresholdRow(label, value, threshold, note) {
  const elevated = value !== null && value > threshold
  return row({
    label,
    value,
    marks: marksWithEnds([threshold]),
    zones: zonesFromThreshold(threshold),
    fill: elevated ? WARN_BAR : CALM_BAR,
    chip: elevated ? WARN_CHIP : PLAIN_CHIP,
    note,
  })
}
