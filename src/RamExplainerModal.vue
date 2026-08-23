<script setup>
import { ramExplainerOpen, closeRamExplainer } from './ramExplainer.js'
</script>

<template>
  <div v-if="ramExplainerOpen" class="ram-explainer-backdrop" @click.self="closeRamExplainer()">
    <div class="ram-explainer" role="dialog" aria-modal="true" aria-label="RAM metrics explained">
      <div class="ram-explainer__header">
        <h2>RAM metrics</h2>
        <button class="ram-explainer__close" @click="closeRamExplainer()" aria-label="Close">&times;</button>
      </div>

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
    </div>
  </div>
</template>

<style scoped>
.ram-explainer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.ram-explainer {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.25);
  padding: 1.25rem 1.5rem 1.5rem;
  max-width: 420px;
  width: calc(100% - 2rem);
}

.ram-explainer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.ram-explainer__header h2 {
  margin: 0;
  font-size: 1.1rem;
  color: #0f172a;
}

.ram-explainer__close {
  border: none;
  background: none;
  font-size: 1.4rem;
  line-height: 1;
  color: #94a3b8;
  cursor: pointer;
  padding: 0 0.25rem;
}

.ram-explainer__close:hover {
  color: #334155;
}

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
