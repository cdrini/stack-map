<script setup>
// Experimental — hardcoded to one metric/VM for now, just to test whether
// the browser can pull live data from Graphite client-side at all. The
// JSON response has no Access-Control-Allow-Origin header (checked via
// curl), so `fetch()` is expected to be blocked by CORS even though the
// server itself is reachable — the <img> fallback bypasses that (images
// aren't subject to the CORS check for basic rendering), so seeing the
// graph render while the number stays in "blocked" state would confirm
// it's specifically a CORS problem, not a reachability one.

import { onMounted, ref } from 'vue'

const props = defineProps({
  target: { type: String, required: true },
})

const GRAPHITE_BASE = 'http://graphite0-web.us.archive.org/render'
const jsonUrl = `${GRAPHITE_BASE}?target=${encodeURIComponent(props.target)}&from=-5min&format=json`
const imgUrl = `${GRAPHITE_BASE}?target=${encodeURIComponent(props.target)}&from=-5min&width=100&height=30`

const status = ref('loading') // 'loading' | 'ok' | 'error'
const value = ref(null)
const errorMessage = ref('')

onMounted(async () => {
  try {
    const res = await fetch(jsonUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const points = data?.[0]?.datapoints ?? []
    const latest = [...points].reverse().find(([v]) => v !== null)
    if (!latest) throw new Error('no datapoints in response')
    value.value = latest[0]
    status.value = 'ok'
  } catch (e) {
    // The browser deliberately hides *why* a cross-origin fetch failed
    // (CORS vs DNS vs offline all look identical here) — "blocked?" is
    // calibrated to that uncertainty, not a confirmed diagnosis.
    errorMessage.value = e instanceof Error ? e.message : String(e)
    status.value = 'error'
  }
})
</script>

<template>
  <div class="cpu-monitor" :title="status === 'error' ? `fetch() failed: ${errorMessage}` : target">
    <span v-if="status === 'loading'" class="cpu-monitor__badge cpu-monitor__badge--loading">…</span>
    <span v-else-if="status === 'ok'" class="cpu-monitor__badge cpu-monitor__badge--ok">
      load {{ value.toFixed(2) }}
    </span>
    <span v-else class="cpu-monitor__badge cpu-monitor__badge--error">fetch blocked?</span>
    <img class="cpu-monitor__img" :src="imgUrl" alt="load graph" title="via <img>, bypasses CORS" />
  </div>
</template>

<style scoped>
.cpu-monitor {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cpu-monitor__badge {
  font-size: 0.55rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 4px;
  white-space: nowrap;
}

.cpu-monitor__badge--loading {
  color: #94a3b8;
}

.cpu-monitor__badge--ok {
  color: #15803d;
  background: #dcfce7;
}

.cpu-monitor__badge--error {
  color: #b91c1c;
  background: #fee2e2;
}

.cpu-monitor__img {
  height: 16px;
  width: auto;
  border-radius: 3px;
}
</style>
