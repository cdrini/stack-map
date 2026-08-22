import { ref } from 'vue'

// Singleton modal state — every DiskBadge instance opens the same modal
// rather than each owning its own, since dozens could exist on screen at
// once but only one explainer should ever be open.
export const diskExplainerOpen = ref(false)

export function openDiskExplainer() {
  diskExplainerOpen.value = true
}

export function closeDiskExplainer() {
  diskExplainerOpen.value = false
}
