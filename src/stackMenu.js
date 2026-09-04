import { spec, linksFor, resolveLinkUrl } from './spec.js'
import { faviconUrl } from './favicon.js'
import { openCpuExplainer } from './cpuExplainer.js'
import { openRamExplainer } from './ramExplainer.js'
import { openDiskExplainer } from './diskExplainer.js'

// Right-click menus cover the whole stack under the cursor, not just the
// thing directly beneath it — right-clicking a VM's disk badge offers that
// metric's explainer, then the VM's own links, then its server's, each
// under its own heading. Whatever was actually clicked comes first, and
// each layer below it follows, so one menu answers "what can I do with
// this?" without having to find some other pixel to aim at.
//
// Sections are UContextMenu's nested-array `items` (each inner array
// renders as its own group, separated by a rule), headed by a
// `type: 'label'` entry — see @nuxt/ui's ContextMenuItem.
//
// A layer with nothing to offer is dropped rather than shown as an empty
// heading, so this stays quiet until there's actually something under it:
// servers currently have no `links:` at all, so no SERVER section appears
// anywhere yet, and it starts appearing on its own once one is added.

// Metric families whose badge has an explainer modal to point at. The rest
// (haproxy, solr, custom) have no METRIC section, so right-clicking one of
// their badges just falls through to the entity's own sections — add an
// entry here when a family gains an explainer.
const METRIC_EXPLAINERS = {
  cpu: openCpuExplainer,
  ram: openRamExplainer,
  disk: openDiskExplainer,
}

// Headings are chrome rather than choices, so they're deliberately quieter
// than the items under them — smaller, grey and letter-spaced, so a section
// reads as a divider you skim past on the way to what you clicked for.
const HEADING_CLASS = 'text-[0.625rem] uppercase tracking-wider text-gray-500'

// A section, or null when it has nothing in it — see the note above about
// dropping empty layers.
function section(heading, items) {
  if (!items.length) return null
  return [{ type: 'label', label: heading, ui: { label: HEADING_CLASS } }, ...items]
}

// An entity's `links:` as menu items. Each shows the link's own favicon,
// falling back to a generic link icon if it 404s or the origin doesn't
// resolve (UAvatar's built-in `error` handling).
function linkItems(entity, entityType) {
  return linksFor(entity, entityType).map((link) => {
    const url = resolveLinkUrl(link, entity.id, entity.hostedOn)
    return {
      label: link.label,
      avatar: { src: faviconUrl(url), icon: 'i-lucide-link' },
      onSelect: () => window.open(url, '_blank', 'noopener'),
    }
  })
}

function metricSection(type) {
  const open = METRIC_EXPLAINERS[type]
  if (!open) return null
  return section(`METRIC: ${type.toUpperCase()}`, [
    { label: 'Learn more', icon: 'i-lucide-book-open', onSelect: () => open() },
  ])
}

function containerSection(container) {
  // Unlike links, "View definition" shows up even when there's nothing to
  // open — a container with no `definition:` is worth surfacing as a gap
  // in the spec rather than silently offering one item fewer.
  return section(`CONTAINER: ${container.image}`, [
    {
      label: 'View definition',
      icon: 'i-lucide-file-code-2',
      disabled: !container.definition,
      onSelect: () => window.open(container.definition, '_blank', 'noopener'),
    },
    ...linkItems(container, 'container'),
  ])
}

function vmSection(vm) {
  // Named the way its box is, so a collapsed replica set's menu says the
  // set's name rather than whichever member represents it.
  return section(`VM: ${vm.replicaSetName ?? vm.id}`, linkItems(vm, 'vm'))
}

function serverSection(server) {
  return section(`SERVER: ${server.id}`, linkItems(server, 'server'))
}

const vmOf = (container) => spec.vms.find((vm) => vm.id === container.hostedOn)
const serverOf = (vm) => spec.servers.find((server) => server.id === vm.hostedOn)

// The menu for `entity` and everything hosting it. `metricType` names the
// metric family whose badge was clicked, when it was a badge rather than
// the entity itself — 'cpu', 'ram' or 'disk' (see METRIC_EXPLAINERS).
export function stackMenuItems(entity, entityType, metricType = null) {
  const layers = [metricType && metricSection(metricType)]

  let vm = entityType === 'vm' ? entity : null
  if (entityType === 'container') {
    layers.push(containerSection(entity))
    vm = vmOf(entity)
  }
  if (vm) {
    layers.push(vmSection(vm))
  }

  const server = entityType === 'server' ? entity : vm && serverOf(vm)
  if (server) {
    layers.push(serverSection(server))
  }

  return layers.filter(Boolean)
}
