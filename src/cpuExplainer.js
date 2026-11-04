import { ref, shallowRef } from 'vue'

// Singleton modal state — every CpuBadge instance opens the same modal
// rather than each owning its own, since dozens could exist on screen at
// once but only one explainer should ever be open.
export const cpuExplainerOpen = ref(false)

// Which badge opened it, and that badge's own live reading — the ref
// itself, not a copy, so the modal keeps up with the refreshes the badge is
// already doing instead of fetching anything of its own. Null when opened
// from somewhere with no reading to hand (the right-click menu's "Learn
// more"), in which case the modal explains the thresholds and shows no
// values. shallowRef because the value is a ref: deep reactivity would
// unwrap it.
export const cpuExplainerContext = shallowRef(null)

export function openCpuExplainer(context = null) {
  cpuExplainerContext.value = context
  cpuExplainerOpen.value = true
}

export function closeCpuExplainer() {
  cpuExplainerOpen.value = false
  cpuExplainerContext.value = null
}
