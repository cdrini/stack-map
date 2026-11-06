<script setup>
import { computed, watch } from 'vue'
import UModal from '@nuxt/ui/components/Modal.vue'
import { vmInfoOpen, vmInfoContext, closeVmInfo } from './vmInfo.js'
import { spec } from './spec.js'
import { osLabel, osIcon, osSupport, loadOsReleases, loadOs } from './osInfo.js'

// node_exporter knows the OS better than the spec does, whose `os`/
// `osVersion` are a snapshot scripts/collect-os.sh took over SSH and go
// stale the moment a box is upgraded — see osInfo.js. Fetched when the
// modal opens rather than with the map: nobody needs it until they ask.
watch(vmInfoContext, (vm) => {
  loadOs(vm)
  loadOsReleases()
})

const icon = computed(() => osIcon(vmInfoContext.value))

// Dates are only shown for a release we actually recognise; an unknown one
// simply has no support row rather than an empty one.
const support = computed(() => {
  const release = osSupport(vmInfoContext.value)
  if (!release) return null
  const until = release.eolFrom
  const over = until ? new Date(until) < new Date() : false
  return {
    released: release.releaseDate,
    until,
    over,
    lts: release.isLts,
    codename: release.codename,
  }
})

function formatDate(iso) {
  // Spelled out rather than numeric: these are read, not sorted, and
  // 2025-05-31 vs 31/05/2025 is exactly the ambiguity to avoid.
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

// What the spec knows about this VM, as opposed to what it's doing right
// now — the metric explainers cover that. Rows with nothing to say are
// dropped rather than shown empty.
const rows = computed(() => {
  const vm = vmInfoContext.value
  if (!vm) return []
  const domain = spec.config?.domain
  const server = spec.servers.find((s) => s.id === vm.hostedOn)
  return [
    ['Hostname', domain ? `${vm.id}.${domain}` : vm.id],
    ['IP', vm.ip],
    ['OS', osLabel(vm)],
    ['Codename', support.value?.codename],
    ['Role', vm.role],
    ['Hosted on', server ? server.id : vm.hostedOn],
    ['Replica set', vm.replicaSet],
  ].filter(([, value]) => value)
})
</script>

<template>
  <UModal :open="vmInfoOpen" :title="vmInfoContext?.id ?? 'VM'" @update:open="(v) => !v && closeVmInfo()">
    <template #body>
      <dl class="vm-info">
        <template v-for="[label, value] in rows" :key="label">
          <dt>{{ label }}</dt>
          <dd>
            <img v-if="label === 'OS' && icon" class="vm-info__icon" :src="icon" :alt="vmInfoContext?.os" />{{ value
            }}<span v-if="label === 'OS' && support?.over" class="vm-info__eol-badge">EOL</span>
          </dd>
        </template>

        <template v-if="support">
          <dt>Released</dt>
          <dd>{{ formatDate(support.released) }}{{ support.lts ? ' · LTS' : '' }}</dd>
          <template v-if="support.until">
            <dt>{{ support.over ? 'Ended' : 'Supported until' }}</dt>
            <dd :class="{ 'vm-info__eol': support.over }">{{ formatDate(support.until) }}</dd>
          </template>
        </template>
      </dl>
    </template>
  </UModal>
</template>

<style scoped>
.vm-info {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.55rem 1rem;
  font-size: 0.85rem;
}

.vm-info dt {
  color: #64748b;
}

.vm-info__icon {
  /* Tailwind's preflight makes images block-level; these sit in a line of
     text. */
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: 0.35rem;
  object-fit: contain;
  vertical-align: -2px;
}

/* Matches the badge on the box itself (VmBox's .map-vm__eol). */
.vm-info__eol-badge {
  display: inline-block;
  margin-left: 0.4rem;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  color: #9a3412;
  background: #ffedd5;
  vertical-align: 1px;
}

/* A release past its end date is the one fact in here worth reacting to.
   Qualified with `dd` so it outranks the colour on `.vm-info dd`. */
.vm-info dd.vm-info__eol {
  color: #b91c1c;
  font-weight: 700;
}

.vm-info dd {
  margin: 0;
  color: #0f172a;
  /* Hostnames, IPs and device lists are all things you copy. */
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
</style>
