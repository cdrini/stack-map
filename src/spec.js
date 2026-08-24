import { load } from 'js-yaml'
import { basePrefix } from './apiBase.js'

// Names real internal Archive infrastructure, so it's never bundled into
// the build (unlike most Vite apps' data) — fetched from the API server at
// runtime instead (see server/main.py's /api/spec and STACKMAP_SPEC_PATH).
// Populated by loadSpec() before the app is mounted (see main.js), so every
// other module can keep treating `spec` as available synchronously.
export const spec = {}

export async function loadSpec() {
  const res = await fetch(`${basePrefix}/api/spec`)
  if (!res.ok) throw new Error(`failed to load stack spec: ${res.status}`)
  Object.assign(spec, load(await res.text()))
  spec.externals ??= []
  spec.metrics ??= []
  spec.links ??= []
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

// Same idea, one level further up — projects onto the servers hosting
// things, for laying out server boxes topologically too (see mapLayout.js's
// computeMapLayout). A container's relationship implies one between the
// servers hosting its VM; a VM edge implies one between its own server and
// the other end's. Externals have no `hostedOn` at all, so any edge
// touching one just doesn't resolve here — same as a VM-to-external edge
// not projecting onto a single VM in buildTopologyEdges above.
export function buildServerTopologyEdges() {
  const vmOfContainer = new Map(spec.containers.map((c) => [c.id, c.hostedOn]))
  const serverOfVm = new Map(spec.vms.map((vm) => [vm.id, vm.hostedOn]))

  function toServerId(id) {
    const vmId = vmOfContainer.get(id) ?? id
    return serverOfVm.get(vmId) ?? null
  }

  const edges = []
  for (const edge of buildEdges()) {
    const from = toServerId(edge.from)
    const to = toServerId(edge.to)
    if (!from || !to || from === to) continue
    edges.push({ from, to })
  }
  return edges
}

// Every metric that applies to one entity: its own `metrics:` list, plus
// any top-level `metrics:` entry whose `filter.type` includes this
// entity's type (or that has no filter/filter.type at all, meaning it
// applies everywhere). `entityType` is 'server' | 'vm' | 'container' |
// 'external', matching stack.yaml's top-level section names singularized.
//
// A query containing `{{disk}}` (e.g. disk-busy/disk-pending) is expanded
// once per device in the entity's own `disks: [vda, vdb]` list (defaulting
// to just `vda`, the common single-disk case) rather than being resolved
// to one metric — a VM's disks can have genuinely different roles (e.g.
// data vs. WAL), so producing one metric per device lets callers show them
// separately instead of conflating them. Each expanded copy carries a
// `disk` field naming its device, for grouping/labeling downstream (see
// metrics.js's `groupDiskMetricsByDisk`).
export function metricsFor(entity, entityType) {
  const ownMetrics = entity.metrics || []
  const globalMetrics = spec.metrics.filter(
    (m) => !m.filter?.type || m.filter.type.includes(entityType)
  )
  const expanded = globalMetrics.flatMap((m) => {
    if (!m.query.includes('{{disk}}')) return [m]
    const disks = entity.disks || ['vda']
    return disks.map((disk) => ({ ...m, disk, query: m.query.replaceAll('{{disk}}', disk) }))
  })
  return [...ownMetrics, ...expanded]
}

// Same idea as metricsFor, for an entity's `links: [{ label, url }]` (see
// stack.yaml's doc comment) — an entity's own links plus whatever
// top-level `links:` entries match its type via `filter`. `{{id}}` in
// `url` is left unresolved here (same as metricsFor's `query`) since
// resolving it needs the entity's own id, supplied by the caller — see
// resolveLinkUrl.
export function linksFor(entity, entityType) {
  const ownLinks = entity.links || []
  const globalLinks = spec.links.filter((l) => !l.filter?.type || l.filter.type.includes(entityType))
  return [...ownLinks, ...globalLinks]
}

// Backs the "Collapse replica sets" toggle (see stack.yaml's doc comment
// on `replicaSet`) — only ever called on the ungrouped views' already-
// flattened VM list, never "Group by server"'s per-server tree, since
// replica-set members routinely live on different physical servers and
// can't share one server's box anyway.
//
// `vms` must already have `.containers` attached (as buildTree() does).
// Returns the collapsed VM list (solo VMs untouched, one representative —
// the lowest-sorted id — per replicaSet group, its `containers` merged
// and de-duped by `image` across every member) plus a flat list of just
// those merged containers (for the container-granularity view, which
// doesn't nest containers inside VMs) and id -> representative-id redirect
// maps for both levels, for remapping edges that referenced a
// now-merged-away VM or container — see redirectEdges.
export function collapseReplicaSets(vms) {
  const solo = []
  const groups = new Map()
  for (const vm of vms) {
    if (!vm.replicaSet) {
      solo.push(vm)
      continue
    }
    if (!groups.has(vm.replicaSet)) groups.set(vm.replicaSet, [])
    groups.get(vm.replicaSet).push(vm)
  }

  const vmRedirect = new Map()
  const containerRedirect = new Map()
  const mergedContainers = []

  const collapsedVms = [...groups.entries()].map(([name, members]) => {
    const sortedMembers = [...members].sort((a, b) => a.id.localeCompare(b.id))
    const representative = sortedMembers[0]
    for (const m of sortedMembers) vmRedirect.set(m.id, representative.id)

    const byImage = new Map()
    for (const vm of sortedMembers) {
      for (const c of vm.containers || []) {
        if (!byImage.has(c.image)) byImage.set(c.image, [])
        byImage.get(c.image).push(c)
      }
    }
    const containers = [...byImage.values()].map((sameImage) => {
      const sorted = [...sameImage].sort((a, b) => a.id.localeCompare(b.id))
      const repContainer = sorted[0]
      for (const c of sorted) containerRedirect.set(c.id, repContainer.id)
      const merged = sorted.length > 1 ? { ...repContainer, replicas: sorted.length } : repContainer
      mergedContainers.push(merged)
      return merged
    })

    return { ...representative, containers, replicaSetName: name, replicaSetSize: sortedMembers.length }
  })

  return { vms: [...solo, ...collapsedVms], mergedContainers, vmRedirect, containerRedirect }
}

// Every container not swept into a replica-set merge above, plus that
// merge's own de-duped representatives — the full node list for the
// container-granularity view once collapsing is on.
export function collapsedContainers(allContainers, collapseResult) {
  const untouched = allContainers.filter((c) => !collapseResult.containerRedirect.has(c.id))
  return [...untouched, ...collapseResult.mergedContainers]
}

// Remaps an edge list (see buildEdges()/buildTopologyEdges()) through
// collapseReplicaSets' id -> representative-id maps, so an edge that
// pointed at a now-merged-away VM/container instead points at its
// representative — then drops the resulting self-loops (both ends merged
// into the same representative) and de-duplicates (several group members
// all queried by the same source collapse to the one edge a viewer
// actually needs to see).
export function redirectEdges(edges, redirect) {
  const seen = new Set()
  const result = []
  for (const edge of edges) {
    const from = redirect.get(edge.from) ?? edge.from
    const to = redirect.get(edge.to) ?? edge.to
    if (from === to) continue
    const key = `${from} ${to} ${edge.label ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ ...edge, from, to })
  }
  return result
}

export function resolveLinkUrl(link, resourceId) {
  return link.url.replaceAll('{{id}}', resourceId)
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
