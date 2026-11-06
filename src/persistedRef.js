import { ref, watch } from 'vue'

// A ref that remembers itself across visits, for the small per-viewer
// preferences the toolbar holds. Deliberately not for anything the map is
// drawn from — that lives in the spec, which everyone sees the same.
//
// Every access is guarded: localStorage throws in a private window and when
// site data is blocked, and reads can come back as something other than
// what was written if a key is edited by hand or left over from an older
// build. In any of those cases this behaves as a plain ref with the default
// value, which is why the parse is type-checked rather than trusted.
const PREFIX = 'stack-map:'

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    const value = JSON.parse(raw)
    return typeof value === typeof fallback ? value : fallback
  } catch {
    return fallback
  }
}

export function persistedRef(key, fallback) {
  const state = ref(read(key, fallback))
  watch(state, (value) => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      // Nothing to do: the toggle still works for this session.
    }
  })
  return state
}
