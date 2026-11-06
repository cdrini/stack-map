import { ref } from 'vue'
import { metricsFor, spec } from './spec.js'
import { fetchLatestMetric, infoMetric } from './metrics.js'
import { basePrefix } from './apiBase.js'

// Each distro's own favicon, same as apps.js does for the software a
// container runs, and for the same reason favicon.js gives: the target's
// own asset rather than a favicon service. `/favicon.ico` is only a
// convention and several of these don't honour it, hence explicit URLs.
export const OS_ICONS = {
  debian: 'https://www.debian.org/favicon.ico',
  ubuntu: 'https://assets.ubuntu.com/v1/be7e4cc6-COF-favicon-32x32.png',
  fedora: 'https://fedoraproject.org/favicon.ico',
  rhel: 'https://www.redhat.com/favicon.ico',
  almalinux: 'https://almalinux.org/fav/favicon.ico',
  'rocky-linux': 'https://rockylinux.org/favicon.png',
}

export function osIcon(vm) {
  return vm?.os ? OS_ICONS[vm.os] : undefined
}

// What OS a VM is running, from node_exporter where it answers and from the
// spec where it doesn't — see the `os-info` metric in stack.yaml. Shared by
// the VM box's optional line and the info modal so the two can't disagree.
//
// Filled on demand and then kept: an OS changes a few times a year, so this
// deliberately doesn't ride the 30s refresh the way a reading does.
export const osLabels = ref({})
const live = osLabels

export function osLabel(vm) {
  return live.value[vm.id]?.label || (vm.os && [vm.os, vm.osVersion].filter(Boolean).join(' ')) || null
}

export async function loadOs(vm) {
  if (!vm || live.value[vm.id]) return
  const metric = infoMetric(metricsFor(vm, 'vm'), 'os-info')
  if (!metric) return
  try {
    const { labels } = await fetchLatestMetric(metric, vm.id)
    const label = labels?.pretty_name || [labels?.id, labels?.version_id].filter(Boolean).join(' ')
    // The product and version are kept alongside the label: the release
    // being run now is what its support dates should be looked up by, not
    // whatever the spec recorded before the last upgrade.
    if (label) {
      live.value = { ...live.value, [vm.id]: { label, product: labels?.id, version: labels?.version_id } }
    }
  } catch {
    // The spec's recorded value stands, which is why it's still recorded.
  }
}

// Release and end-of-life dates, by product — see /api/os-releases, which
// caches them server-side. Asked for once per distinct `os` across the
// whole spec rather than per VM, since the dataset is per product: a fleet
// of fifty boxes running two distros is still two requests, once.
const releases = ref({})
let requested = null

export async function loadOsReleases() {
  if (requested) return requested
  const products = [...new Set(spec.vms.map((vm) => vm.os).filter(Boolean))]
  if (!products.length) return
  const params = new URLSearchParams(products.map((p) => ['product', p]))
  requested = fetch(`${basePrefix}/api/os-releases?${params}`)
    .then((res) => (res.ok ? res.json() : {}))
    .then((data) => {
      releases.value = data
    })
    .catch(() => {
      // Dates are a nicety; the map is fine without them.
    })
  return requested
}

// What's known about the release a VM is actually running. Matched on the
// version the spec recorded, whose `cycle` is exactly endoflife.date's
// release name for every distro here.
export function osSupport(vm) {
  if (!vm) return null
  const known = live.value[vm.id]
  const product = known?.product || vm.os
  const version = known?.version || vm.osVersion
  if (!product || !version) return null
  return (releases.value[product] || []).find((r) => r.name === version) || null
}

// endoflife.date precomputes this, so a release that ends today flips
// without anyone redeploying; the date comparison is only a fallback for
// data that predates the field.
export function isEol(vm) {
  const release = osSupport(vm)
  if (!release) return false
  if (typeof release.isEol === 'boolean') return release.isEol
  return release.eolFrom ? new Date(release.eolFrom) < new Date() : false
}
