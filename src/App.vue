<script setup>
import UApp from '@nuxt/ui/components/App.vue'
import MapView from './MapView.vue'
import CpuExplainerModal from './CpuExplainerModal.vue'
import DiskExplainerModal from './DiskExplainerModal.vue'
import RamExplainerModal from './RamExplainerModal.vue'
</script>

<template>
  <UApp>
    <MapView />
    <CpuExplainerModal />
    <DiskExplainerModal />
    <RamExplainerModal />
  </UApp>
</template>
