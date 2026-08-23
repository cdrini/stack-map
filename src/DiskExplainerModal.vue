<script setup>
import UModal from '@nuxt/ui/components/Modal.vue'
import { diskExplainerOpen, closeDiskExplainer } from './diskExplainer.js'
</script>

<template>
  <UModal :open="diskExplainerOpen" title="Disk metrics" @update:open="(v) => !v && closeDiskExplainer()">
    <template #body>
      <dl class="disk-explainer__list">
        <dt><span class="disk-explainer__chip disk-explainer__chip--busy">Busy</span></dt>
        <dd>
          collectd's <code>disk_io_time</code> — the share of each second the disk spent servicing
          I/O, exactly what <code>iostat %util</code> shows. This is what the badge is colored by:
          green under 50%, yellow 50&ndash;75%, orange 75&ndash;90%, red above that.
        </dd>

        <dt><span class="disk-explainer__chip disk-explainer__chip--warn">pending</span></dt>
        <dd>
          <code>disk_ops.pending_operations</code> — the disk's queue depth: how many requests are
          waiting rather than completing immediately. A brief blip is normal; a sustained value
          means the disk can't keep up with demand. Only shown when it climbs above 1.
        </dd>
      </dl>
    </template>
  </UModal>
</template>

<style scoped>
.disk-explainer__list {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.6rem 0.8rem;
}

.disk-explainer__list dt {
  padding-top: 0.1rem;
}

.disk-explainer__list dd {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
  color: #334155;
}

.disk-explainer__list code {
  font-size: 0.8em;
  background: #f1f5f9;
  padding: 0.1em 0.3em;
  border-radius: 4px;
}

.disk-explainer__chip {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.disk-explainer__chip--busy {
  color: #15803d;
  background: #dcfce7;
}

.disk-explainer__chip--warn {
  color: #9a3412;
  background: #ffedd5;
}
</style>
