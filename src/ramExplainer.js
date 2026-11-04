import { ref, shallowRef } from 'vue'

// Singleton modal state — every MemBadge instance opens the same modal
// rather than each owning its own, since dozens could exist on screen at
// once but only one explainer should ever be open.
export const ramExplainerOpen = ref(false)

// Which badge opened it, and that badge's own live reading — see
// cpuExplainer.js, which this mirrors.
export const ramExplainerContext = shallowRef(null)

export function openRamExplainer(context = null) {
  ramExplainerContext.value = context
  ramExplainerOpen.value = true
}

export function closeRamExplainer() {
  ramExplainerOpen.value = false
  ramExplainerContext.value = null
}
