import { ref } from 'vue'

// Singleton modal state — every MemBadge instance opens the same modal
// rather than each owning its own, since dozens could exist on screen at
// once but only one explainer should ever be open.
export const ramExplainerOpen = ref(false)

export function openRamExplainer() {
  ramExplainerOpen.value = true
}

export function closeRamExplainer() {
  ramExplainerOpen.value = false
}
