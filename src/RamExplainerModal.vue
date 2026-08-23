<script setup>
import UModal from '@nuxt/ui/components/Modal.vue'
import { ramExplainerOpen, closeRamExplainer } from './ramExplainer.js'
</script>

<template>
  <UModal :open="ramExplainerOpen" title="RAM metrics" @update:open="(v) => !v && closeRamExplainer()">
    <template #body>
      <dl class="ram-explainer__list">
        <dt><span class="ram-explainer__chip ram-explainer__chip--used">used</span></dt>
        <dd>
          collectd's <code>memory.used</code> plus non-reclaimable slab — kernel/application memory that
          isn't coming back without something actually freeing it. This is what the badge's busy % and
          color (green under 50%, yellow 50&ndash;75%, orange 75&ndash;90%, red above that) are based on.
        </dd>

        <dt><span class="ram-explainer__chip ram-explainer__chip--cached">cached</span></dt>
        <dd>
          <code>memory.cached</code> — mostly the page cache (recently-read files, etc). Reclaimable: Linux
          hands it back instantly under real memory pressure, so it's excluded from "used"/busy% above.
          Shown separately because "free" alone undercounts how much RAM a healthy box actually has
          available in practice — most of it usually shows up here instead.
        </dd>

        <dt><span class="ram-explainer__chip ram-explainer__chip--total">total</span></dt>
        <dd>
          used + cached + free + buffered + reclaimable slab — the VM or server's full physical RAM.
        </dd>

        <dt><span class="ram-explainer__chip ram-explainer__chip--warn">swap</span></dt>
        <dd>
          Percent of swap space in use — only shown when non-negligible (above 1%), since any real swapping
          at all means this VM is genuinely out of RAM, not just "somewhat full."
        </dd>
      </dl>
    </template>
  </UModal>
</template>

<style scoped>
.ram-explainer__list {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.6rem 0.8rem;
}

.ram-explainer__list dt {
  padding-top: 0.1rem;
}

.ram-explainer__list dd {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
  color: #334155;
}

.ram-explainer__list code {
  font-size: 0.8em;
  background: #f1f5f9;
  padding: 0.1em 0.3em;
  border-radius: 4px;
}

.ram-explainer__chip {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.ram-explainer__chip--used {
  color: #15803d;
  background: #dcfce7;
}

.ram-explainer__chip--cached {
  color: #1d4ed8;
  background: #dbeafe;
}

.ram-explainer__chip--total {
  color: #334155;
  background: #e2e8f0;
}

.ram-explainer__chip--warn {
  color: #9a3412;
  background: #ffedd5;
}
</style>
