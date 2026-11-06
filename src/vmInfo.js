import { ref, shallowRef } from 'vue'

// Singleton modal state — every VM box opens the same modal rather than
// each owning one, same as the metric explainers.
export const vmInfoOpen = ref(false)

// The VM whose box was clicked. Plain object off the spec, not a live
// reading, so a shallowRef is enough.
export const vmInfoContext = shallowRef(null)

export function openVmInfo(vm) {
  vmInfoContext.value = vm
  vmInfoOpen.value = true
}

export function closeVmInfo() {
  vmInfoOpen.value = false
  vmInfoContext.value = null
}
