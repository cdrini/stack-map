<script setup>
import { colorFor } from './spec.js'
import { appFor } from './apps.js'
import CpuMonitor from './CpuMonitor.vue'

defineProps({
  vm: { type: Object, required: true },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
})
</script>

<template>
  <div class="map-vm" :style="{ left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px' }">
    <div class="map-vm__header">
      <span class="map-vm__name">{{ vm.id }}</span>
      <!-- Hardcoded to one VM for now — testing the FastAPI proxy before
           building this out for every VM. -->
      <CpuMonitor v-if="vm.id === 'ol-web0'" vm-id="ol-web0" />
      <span v-if="vm.role" class="map-vm__role">{{ vm.role }}</span>
    </div>

    <div v-if="vm.containers.length" class="map-vm__containers">
      <div
        v-for="c in vm.containers"
        :key="c.id"
        class="map-container"
        :style="{ borderColor: colorFor(c.role || c.image) }"
        :title="c.role || c.image"
      >
        <img
          v-if="appFor(c.application)?.icon"
          class="map-container__icon"
          :src="appFor(c.application).icon"
          :alt="appFor(c.application).label"
        />
        <span v-else class="map-container__dot" :style="{ background: colorFor(c.role || c.image) }" />
        <span class="map-container__label">{{ c.image }}</span>
      </div>
    </div>
    <div v-else class="map-vm__empty">no containers</div>
  </div>
</template>

<style scoped>
.map-vm {
  position: absolute;
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  box-sizing: border-box;
  padding: 4px 6px;
  overflow: hidden;
}

.map-vm__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem;
  margin-bottom: 3px;
}

.map-vm__name {
  font-weight: 600;
  font-size: 0.72rem;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.map-vm__role {
  font-size: 0.6rem;
  color: #94a3b8;
  white-space: nowrap;
}

.map-vm__containers {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.map-vm__empty {
  font-size: 0.65rem;
  color: #cbd5e1;
  font-style: italic;
}

.map-container {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.65rem;
  height: 20px;
  padding: 0 0.4rem;
  border: 1px solid;
  border-radius: 5px;
  background: #fafafa;
  color: #334155;
  box-sizing: border-box;
}

.map-container__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  flex: none;
}

.map-container__icon {
  width: 11px;
  height: 11px;
  flex: none;
  object-fit: contain;
}

.map-container__label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
