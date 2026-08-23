<script setup>
import UModal from '@nuxt/ui/components/Modal.vue'
import { cpuExplainerOpen, closeCpuExplainer } from './cpuExplainer.js'
</script>

<template>
  <UModal :open="cpuExplainerOpen" title="CPU metrics" @update:open="(v) => !v && closeCpuExplainer()">
    <template #body>
      <dl class="cpu-explainer__list">
        <dt><span class="cpu-explainer__chip cpu-explainer__chip--busy">Busy</span></dt>
        <dd>
          100 &minus; collectd's <code>cpu.percent-idle</code> — the share of time the CPU wasn't idle,
          already normalized to 0&ndash;100% regardless of how many cores the machine has, so it's directly
          comparable across VMs and servers. This is what the badge is colored by: green under 50%, yellow
          50&ndash;75%, orange 75&ndash;90%, red above that.
        </dd>

        <dt><span class="cpu-explainer__chip cpu-explainer__chip--warn">wait</span></dt>
        <dd>
          <code>cpu.percent-wait</code> — time spent waiting on I/O (disk or network), not doing compute.
          High wait means the machine looks busy but isn't CPU-bound — the bottleneck is elsewhere, so adding
          CPU capacity wouldn't help. Only shown when it climbs above 10%.
        </dd>

        <dt><span class="cpu-explainer__chip cpu-explainer__chip--warn">steal</span></dt>
        <dd>
          <code>cpu.percent-steal</code> — time this VM was ready to run but the hypervisor gave the physical
          CPU to a different VM instead. Only meaningful on virtualized hosts; a nonzero value means the
          underlying bare-metal server is oversubscribed — something CPU busy% alone can't show, since this VM
          could look idle while still being starved. Only shown when it climbs above 5%.
        </dd>
      </dl>
    </template>
  </UModal>
</template>

<style scoped>
.cpu-explainer__list {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.6rem 0.8rem;
}

.cpu-explainer__list dt {
  padding-top: 0.1rem;
}

.cpu-explainer__list dd {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
  color: #334155;
}

.cpu-explainer__list code {
  font-size: 0.8em;
  background: #f1f5f9;
  padding: 0.1em 0.3em;
  border-radius: 4px;
}

.cpu-explainer__chip {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.cpu-explainer__chip--busy {
  color: #15803d;
  background: #dcfce7;
}

.cpu-explainer__chip--warn {
  color: #9a3412;
  background: #ffedd5;
}
</style>
