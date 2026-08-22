<script setup>
import { computed } from 'vue'
import { buildTree, colorFor } from './spec.js'
import { appFor } from './apps.js'

const tree = computed(() => buildTree())
</script>

<template>
  <div class="column-view">
    <div class="racks">
      <section v-for="server in tree" :key="server.id" class="rack">
        <div class="rack__label">
          <span class="rack__icon">&#9639;</span>
          {{ server.id }}
        </div>

        <div class="rack__vms">
          <article v-for="vm in server.vms" :key="vm.id" class="vm">
            <div class="vm__header">
              <span class="vm__name">{{ vm.id }}</span>
              <span v-if="vm.role" class="vm__role">{{ vm.role }}</span>
            </div>

            <div v-if="vm.containers.length" class="vm__containers">
              <div
                v-for="c in vm.containers"
                :key="c.id"
                class="container-chip"
                :style="{ borderColor: colorFor(c.role || c.image) }"
                :title="c.role || c.image"
              >
                <img
                  v-if="appFor(c.application)?.icon"
                  class="container-chip__icon"
                  :src="appFor(c.application).icon"
                  :alt="appFor(c.application).label"
                />
                <span
                  v-else
                  class="container-chip__dot"
                  :style="{ background: colorFor(c.role || c.image) }"
                />
                {{ c.image }}
              </div>
            </div>
            <div v-else class="vm__no-containers">no containerized services</div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.column-view {
  padding: 0 1.5rem 2rem;
}

.racks {
  display: flex;
  gap: 1.5rem;
  overflow-x: auto;
  padding-bottom: 1rem;
}

.rack {
  flex: 0 0 260px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.rack__label {
  font-weight: 600;
  font-size: 1rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #0f172a;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 0.6rem;
}

.rack__icon {
  color: #94a3b8;
}

.rack__vms {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.vm {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.6rem 0.7rem;
}

.vm__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}

.vm__name {
  font-weight: 600;
  font-size: 0.9rem;
  color: #0f172a;
}

.vm__role {
  font-size: 0.72rem;
  color: #94a3b8;
  white-space: nowrap;
}

.vm__containers {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.vm__no-containers {
  font-size: 0.75rem;
  color: #cbd5e1;
  font-style: italic;
}

.container-chip {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid;
  border-radius: 6px;
  background: #fafafa;
  color: #334155;
}

.container-chip__dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex: none;
}

.container-chip__icon {
  width: 12px;
  height: 12px;
  flex: none;
  object-fit: contain;
}
</style>
