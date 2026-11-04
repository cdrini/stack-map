import { ref, shallowRef } from 'vue'

// Singleton modal state — every DiskBadge instance opens the same modal
// rather than each owning its own, since dozens could exist on screen at
// once but only one explainer should ever be open.
export const diskExplainerOpen = ref(false)

// Which badge opened it, and that badge's own live reading — see
// cpuExplainer.js, which this mirrors. A disk badge also passes the device
// it speaks for, since a VM can have several.
export const diskExplainerContext = shallowRef(null)

export function openDiskExplainer(context = null) {
  diskExplainerContext.value = context
  diskExplainerOpen.value = true
}

export function closeDiskExplainer() {
  diskExplainerOpen.value = false
  diskExplainerContext.value = null
}
