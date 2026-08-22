import { ref } from 'vue'

// Singleton modal state — every CpuBadge instance opens the same modal
// rather than each owning its own, since dozens could exist on screen at
// once but only one explainer should ever be open.
export const cpuExplainerOpen = ref(false)

export function openCpuExplainer() {
  cpuExplainerOpen.value = true
}

export function closeCpuExplainer() {
  cpuExplainerOpen.value = false
}
