<script setup>
const props = defineProps({
  external: { type: Object, required: true },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  // Same hover-dimming contract as VmBox.vue's container chips — an
  // external is a graph node in its own right (see MapView.vue's
  // attachedContainerIds), just never itself a VM full of containers.
  attachedContainerIds: { type: Set, default: null },
})

const emit = defineEmits(['hover-container'])
</script>

<template>
  <div
    class="map-external"
    :class="{ 'map-external--dimmed': attachedContainerIds && !attachedContainerIds.has(external.id) }"
    :style="{ left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px' }"
    :title="external.label"
    @mouseenter="emit('hover-container', external.id)"
    @mouseleave="emit('hover-container', null)"
  >
    <span class="map-external__icon">{{ external.icon }}</span>
    <span class="map-external__label">{{ external.label }}</span>
  </div>
</template>

<style scoped>
.map-external {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: #f0f9ff;
  border: 1.5px dashed #38bdf8;
  border-radius: 10px;
  box-sizing: border-box;
  transition: opacity 0.15s;
}

.map-external--dimmed {
  opacity: 0.3;
}

.map-external__icon {
  font-size: 1.2rem;
  line-height: 1;
}

.map-external__label {
  font-size: 0.68rem;
  font-weight: 600;
  color: #0369a1;
  white-space: nowrap;
}
</style>
