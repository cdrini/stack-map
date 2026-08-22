<script setup>
import { diskExplainerOpen, closeDiskExplainer } from './diskExplainer.js'
</script>

<template>
  <div v-if="diskExplainerOpen" class="disk-explainer-backdrop" @click.self="closeDiskExplainer()">
    <div class="disk-explainer" role="dialog" aria-modal="true" aria-label="Disk metrics explained">
      <div class="disk-explainer__header">
        <h2>Disk metrics</h2>
        <button class="disk-explainer__close" @click="closeDiskExplainer()" aria-label="Close">&times;</button>
      </div>

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
    </div>
  </div>
</template>

<style scoped>
.disk-explainer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.disk-explainer {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.25);
  padding: 1.25rem 1.5rem 1.5rem;
  max-width: 420px;
  width: calc(100% - 2rem);
}

.disk-explainer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.disk-explainer__header h2 {
  margin: 0;
  font-size: 1.1rem;
  color: #0f172a;
}

.disk-explainer__close {
  border: none;
  background: none;
  font-size: 1.4rem;
  line-height: 1;
  color: #94a3b8;
  cursor: pointer;
  padding: 0 0.25rem;
}

.disk-explainer__close:hover {
  color: #334155;
}

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
