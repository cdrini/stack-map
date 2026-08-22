<script setup>
defineProps({
  external: { type: Object, required: true },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
})
</script>

<template>
  <div
    class="map-external"
    :style="{ left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px' }"
    :title="external.label"
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
