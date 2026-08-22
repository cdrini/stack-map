<script setup>
import { ref } from 'vue'
import MapView from './MapView.vue'
import ColumnView from './ColumnView.vue'
import CpuExplainerModal from './CpuExplainerModal.vue'

const activeView = ref('map')
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
      <div class="view-toggle">
        <button :class="{ active: activeView === 'map' }" @click="activeView = 'map'">Map</button>
        <button :class="{ active: activeView === 'columns' }" @click="activeView = 'columns'">Columns</button>
      </div>
    </header>

    <MapView v-if="activeView === 'map'" />
    <ColumnView v-else />

    <CpuExplainerModal />
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

.view-toggle {
  display: flex;
  gap: 0.25rem;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 0.2rem;
  flex: none;
}

.view-toggle button {
  border: none;
  background: transparent;
  padding: 0.35rem 0.8rem;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  color: #475569;
}

.view-toggle button.active {
  background: #0f172a;
  color: #fff;
}
</style>
