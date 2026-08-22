<script setup>
// Experimental — hardcoded to one VM for now. The number now comes from
// our own FastAPI proxy (server/main.py), which makes the Graphite request
// server-side to sidestep the missing Access-Control-Allow-Origin header
// on Graphite's own response (confirmed via curl — the endpoint is
// reachable, just not browser-fetchable directly). The graph image still
// hits Graphite directly, since <img> isn't subject to that CORS check.

import { onMounted, ref } from 'vue'

const props = defineProps({
  vmId: { type: String, required: true },
})

const API_BASE = 'http://localhost:8000'
const GRAPHITE_BASE = 'http://graphite0-web.us.archive.org/render'
const target = `collectd.${props.vmId}_us_archive_org.load.load.shortterm`
const imgUrl = `${GRAPHITE_BASE}?target=${encodeURIComponent(target)}&from=-5min&width=100&height=30`

const status = ref('loading') // 'loading' | 'ok' | 'error'
const value = ref(null)
const errorMessage = ref('')

onMounted(async () => {
  try {
    const res = await fetch(`${API_BASE}/api/vms/${encodeURIComponent(props.vmId)}/load`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    value.value = data.value
    status.value = 'ok'
  } catch (e) {
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
    <span v-else class="cpu-monitor__badge cpu-monitor__badge--error">api unreachable?</span>
    <img class="cpu-monitor__img" :src="imgUrl" alt="load graph" title="via <img>, straight to Graphite" />
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
