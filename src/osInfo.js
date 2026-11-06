import { ref } from 'vue'
import { metricsFor } from './spec.js'
import { fetchLatestMetric, infoMetric } from './metrics.js'

// What OS a VM is running, from node_exporter where it answers and from the
// spec where it doesn't — see the `os-info` metric in stack.yaml. Shared by
// the VM box's optional line and the info modal so the two can't disagree.
//
// Filled on demand and then kept: an OS changes a few times a year, so this
// deliberately doesn't ride the 30s refresh the way a reading does.
export const osLabels = ref({})
const live = osLabels

export function osLabel(vm) {
  return live.value[vm.id] || (vm.os && [vm.os, vm.osVersion].filter(Boolean).join(' ')) || null
}

export async function loadOs(vm) {
  if (!vm || live.value[vm.id]) return
  const metric = infoMetric(metricsFor(vm, 'vm'), 'os-info')
  if (!metric) return
  try {
    const { labels } = await fetchLatestMetric(metric, vm.id)
    const label = labels?.pretty_name || [labels?.id, labels?.version_id].filter(Boolean).join(' ')
    if (label) live.value = { ...live.value, [vm.id]: label }
  } catch {
    // The spec's recorded value stands, which is why it's still recorded.
  }
}
