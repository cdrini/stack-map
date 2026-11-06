<script setup>
import { computed, watch } from 'vue'
import UModal from '@nuxt/ui/components/Modal.vue'
import { vmInfoOpen, vmInfoContext, closeVmInfo } from './vmInfo.js'
import { spec } from './spec.js'
import { osLabel, loadOs } from './osInfo.js'

// node_exporter knows the OS better than the spec does, whose `os`/
// `osVersion` are a snapshot scripts/collect-os.sh took over SSH and go
// stale the moment a box is upgraded — see osInfo.js. Fetched when the
// modal opens rather than with the map: nobody needs it until they ask.
watch(vmInfoContext, (vm) => loadOs(vm))

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
