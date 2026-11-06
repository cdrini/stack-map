<script setup>
import { computed, ref, watch } from 'vue'
import UModal from '@nuxt/ui/components/Modal.vue'
import { vmInfoOpen, vmInfoContext, closeVmInfo } from './vmInfo.js'
import { spec, metricsFor } from './spec.js'
import { fetchLatestMetric, infoMetric } from './metrics.js'

// node_exporter knows the OS better than this file does: the spec's
// `os`/`osVersion` are a snapshot scripts/collect-os.sh took over SSH, and
// go stale the moment a box is upgraded. So the live metric wins where
// there is one, and the recorded value is the fallback — for the bare-metal
// servers, which run no exporter, and for whenever Prometheus is away.
//
// Fetched when the modal opens rather than with the map: it's one request
// for one VM, and nobody needs it until they ask.
const liveOs = ref(null)

watch(vmInfoContext, async (vm) => {
  liveOs.value = null
  if (!vm) return
  const metric = infoMetric(metricsFor(vm, 'vm'), 'os-info')
  if (!metric) return
  try {
    const { labels } = await fetchLatestMetric(metric, vm.id)
    if (vmInfoContext.value?.id !== vm.id) return // a different VM was opened meanwhile
    liveOs.value = labels?.pretty_name || [labels?.id, labels?.version_id].filter(Boolean).join(' ') || null
  } catch {
    // Falls back to the spec, which is the point of still recording it.
  }
})

// What the spec knows about this VM, as opposed to what it's doing right
// now — the metric explainers cover that. Rows with nothing to say are
// dropped rather than shown empty.
const rows = computed(() => {
  const vm = vmInfoContext.value
  if (!vm) return []
  const domain = spec.config?.domain
  const server = spec.servers.find((s) => s.id === vm.hostedOn)
  const containers = spec.containers.filter((c) => c.hostedOn === vm.id)
  return [
    ['Hostname', domain ? `${vm.id}.${domain}` : vm.id],
    ['IP', vm.ip],
    ['OS', liveOs.value || (vm.os && [vm.os, vm.osVersion].filter(Boolean).join(' '))],
    ['Role', vm.role],
    ['Hosted on', server ? server.id : vm.hostedOn],
    ['Replica set', vm.replicaSet],
    ['Disks', vm.disks?.join(', ')],
    ['Containers', containers.length ? containers.map((c) => c.image).join(', ') : null],
  ].filter(([, value]) => value)
})
</script>

<template>
  <UModal :open="vmInfoOpen" :title="vmInfoContext?.id ?? 'VM'" @update:open="(v) => !v && closeVmInfo()">
    <template #body>
      <dl class="vm-info">
        <template v-for="[label, value] in rows" :key="label">
          <dt>{{ label }}</dt>
          <dd>{{ value }}</dd>
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

.vm-info dd {
  margin: 0;
  color: #0f172a;
  /* Hostnames, IPs and device lists are all things you copy. */
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
</style>
