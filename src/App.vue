<script setup>
import { ref } from 'vue'
import MapView from './MapView.vue'
import CpuExplainerModal from './CpuExplainerModal.vue'
import DiskExplainerModal from './DiskExplainerModal.vue'

const hoverDimEnabled = ref(true)
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div>
        <h1>Stack Map</h1>
        <p class="app-header__subtitle">
          Baremetal &rarr; VM &rarr; container topology, with live Graphite metrics starting on CPU.
        </p>
      </div>
      <label class="app-header__toggle">
        <input type="checkbox" v-model="hoverDimEnabled" />
        Dim unrelated on hover
      </label>
    </header>

    <MapView :hover-dim-enabled="hoverDimEnabled" />

    <CpuExplainerModal />
    <DiskExplainerModal />
  </div>
</template>

<style scoped>
.app-shell {
  max-width: 1600px;
  margin: 0 auto;
}

.app-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 2rem 1.5rem 1.25rem;
}

.app-header h1 {
  margin: 0 0 0.25rem;
  font-size: 1.75rem;
}

.app-header__subtitle {
  margin: 0;
  color: #64748b;
}

.app-header__toggle {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.85rem;
  color: #334155;
  cursor: pointer;
  white-space: nowrap;
  margin-top: 0.3rem;
}
</style>
