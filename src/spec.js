import { load } from 'js-yaml'
import specText from './stack.yaml?raw'

export const spec = load(specText)
spec.externals ??= []

const ROLE_COLORS = {
  gunicorn: '#2563eb',
  'gunicorn (fast lane)': '#1d4ed8',
  haproxy: '#d97706',
  nginx: '#059669',
  postgres: '#7c3aed',
  memcached: '#db2777',
  'solr leader': '#0891b2',
  'solr follower': '#0e7490',
  monitoring: '#6b7280',
}

export function colorFor(role) {
  if (!role) return '#334155'
  const key = Object.keys(ROLE_COLORS).find((r) => role.startsWith(r))
  return key ? ROLE_COLORS[key] : '#334155'
}

// Any server, VM, container, or external carries a `relationships: [{ to,
// label }]` field in stack.yaml. This flattens all of them into one edge
// list, independent of which level (or externality) either end is at.
export function buildEdges() {
  const entities = [...spec.servers, ...spec.vms, ...spec.containers, ...spec.externals]
  const edges = []
  for (const entity of entities) {
    for (const rel of entity.relationships || []) {
      edges.push({ from: entity.id, to: rel.to, label: rel.label })
    }
  }
  return edges
}

// Projects buildEdges()'s entity-level edges down to the ids of the things
// the ungrouped map view actually positions — VMs and externals — for
// layouts that order them by their relationships. A container's
// relationship implies one between the VMs hosting it; a VM or external
// edge passes through unchanged. A server-level edge endpoint doesn't
// project onto a single VM, so any edge touching one is dropped, as are
// self-loops from two containers on the same VM (meaningless once
// projected).
export function buildTopologyEdges() {
  const nodeIds = new Set([...spec.vms.map((vm) => vm.id), ...spec.externals.map((e) => e.id)])
  const vmOfContainer = new Map(spec.containers.map((c) => [c.id, c.hostedOn]))

  function toNodeId(id) {
    if (nodeIds.has(id)) return id
    return vmOfContainer.get(id) ?? null
  }

  const edges = []
  for (const edge of buildEdges()) {
    const from = toNodeId(edge.from)
    const to = toNodeId(edge.to)
    if (!from || !to || from === to) continue
    edges.push({ from, to })
  }
  return edges
}

export function buildTree() {
  return spec.servers.map((server) => {
    const vms = spec.vms
      .filter((vm) => vm.hostedOn === server.id)
      .map((vm) => ({
        ...vm,
        containers: spec.containers.filter((c) => c.hostedOn === vm.id),
      }))
    return { ...server, vms }
  })
}
