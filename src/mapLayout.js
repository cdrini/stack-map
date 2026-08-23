// Geometry for the 2D map view: nested rectangles (server > VM > container)
// laid out on a single canvas. Pure functions of the tree from buildTree()
// PLUS each VM's real measured size (see MapView.vue's calibration pool),
// kept separate from MapView.vue so the packing logic can be reasoned about
// without the rendering/pan-zoom concerns.
//
// VM/container geometry used to be predicted here from a stack of
// independently-evolvable constants (header height, metrics-row height,
// divider height, container height, padding, border) that had to be
// hand-kept in sync with VmBox.vue's CSS — and drifted out of sync more
// than once. Now it's read from the DOM instead of guessed: `measuredSizes`
// (a Map of vm.id -> { width, height, containers }) is measured by
// VmBox.vue's own `measure()` and passed in by the caller, so this file
// never needs to know what a VM box is actually made of.

import { buildEdges, buildTopologyEdges, buildServerTopologyEdges } from './spec.js'
import { EXTERNAL_NODE_WIDTH, EXTERNAL_NODE_HEIGHT } from './externalLayout.js'

const VM_GAP = 8
const SERVER_PADDING = 14
const SERVER_HEADER = 32
const SERVER_GAP = 28
const COLUMN_GAP = 84 // horizontal gap between topological columns in the flat (ungrouped) map view
const MAX_ROW_WIDTH = 1500

function layoutVm(vm, measured) {
  const containerPositions = vm.containers.map((container) => {
    const m = measured.containers.find((c) => c.id === container.id)
    return { container, x: m.x, y: m.y, width: m.width, height: m.height }
  })
  return { kind: 'vm', id: vm.id, vm, width: measured.width, height: measured.height, containerPositions }
}

function layoutExternalNode(external) {
  return { kind: 'external', id: external.id, external, width: EXTERNAL_NODE_WIDTH, height: EXTERNAL_NODE_HEIGHT }
}

// Same shape as layoutVm's return value, minus containerPositions — a
// container is already the leaf unit when "Group by VM" is unchecked (see
// computeContainerMapLayout), so there's nothing further to descend into.
function layoutContainerNode(container, measured) {
  return { kind: 'container', id: container.id, container, width: measured.width, height: measured.height }
}

// The VM (default) or container ("Group by VM" unchecked) dims hosted on
// one server — the unit computeMapLayout positions within that server's
// box, either topologically or grid-packed below.
function unitsForServer(server, granularity, measuredSizes) {
  if (granularity === 'vm') return server.vms.map((vm) => layoutVm(vm, measuredSizes.get(vm.id)))
  return server.vms.flatMap((vm) => vm.containers).map((c) => layoutContainerNode(c, measuredSizes.get(c.id)))
}

// One server's units (VMs, or containers when "Group by VM" is unchecked),
// positioned topologically — a server's rectangle is exactly as wide/tall
// as its own units' relationships demand, rather than a fixed grid.
// `edges` is already projected down to whichever granularity `units` are
// at (buildTopologyEdges() for VMs, buildEdges() directly for containers —
// see computeMapLayout) and filtered here to edges where both ends are
// hosted on this server; an edge leaving the server can't meaningfully
// position anything inside this one box, so it's simply not part of this
// server's own sub-layout (it's still drawn on the full map, same as any
// other edge — see MapView.vue's renderedEdges).
function layoutServerTopo(server, units, edges) {
  const unitIds = new Set(units.map((u) => u.id))
  const localEdges = edges.filter((e) => unitIds.has(e.from) && unitIds.has(e.to))
  const topo = computeTopologicalLayout(units, localEdges)

  const unitPositions = topo.positions.map((p) => ({
    ...p,
    x: p.x + SERVER_PADDING,
    y: p.y + SERVER_HEADER + SERVER_PADDING,
  }))

  return {
    kind: 'server',
    id: server.id,
    server,
    unitPositions,
    width: topo.totalWidth + SERVER_PADDING * 2,
    height: SERVER_HEADER + SERVER_PADDING * 2 + topo.totalHeight,
  }
}

// Same units, packed into a relationship-blind sqrt-ish grid instead — the
// map's original "Group by server" behavior, kept as the "Grid" choice in
// the layout-algorithm picker (see MapView.vue) now that layoutServerTopo
// exists as the default.
function layoutServerGrid(server, units) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(units.length || 1)))
  const colWidths = []
  const rowHeights = []

  units.forEach((dim, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    colWidths[col] = Math.max(colWidths[col] || 0, dim.width)
    rowHeights[row] = Math.max(rowHeights[row] || 0, dim.height)
  })

  const colX = []
  let acc = 0
  for (let c = 0; c < cols; c++) {
    colX[c] = acc
    acc += (colWidths[c] || 0) + VM_GAP
  }
  const rowY = []
  acc = 0
  for (let r = 0; r < rowHeights.length; r++) {
    rowY[r] = acc
    acc += rowHeights[r] + VM_GAP
  }

  const unitPositions = units.map((dim, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    return {
      ...dim,
      x: SERVER_PADDING + colX[col],
      y: SERVER_HEADER + SERVER_PADDING + rowY[row],
    }
  })

  const contentWidth = colWidths.reduce((a, b) => a + b, 0) + VM_GAP * Math.max(0, cols - 1)
  const contentHeight =
    rowHeights.reduce((a, b) => a + b, 0) + VM_GAP * Math.max(0, rowHeights.length - 1)

  return {
    kind: 'server',
    id: server.id,
    server,
    unitPositions,
    width: contentWidth + SERVER_PADDING * 2,
    height: SERVER_HEADER + SERVER_PADDING * 2 + contentHeight,
  }
}

// Left-to-right packing that wraps to a new row once maxRowWidth is
// exceeded — shared by the server-level and (ungrouped) VM-level layouts.
function shelfPack(dims, gap, maxRowWidth) {
  const positions = []
  let x = 0
  let y = 0
  let rowHeight = 0

  dims.forEach((dim) => {
    if (x > 0 && x + dim.width > maxRowWidth) {
      x = 0
      y += rowHeight + gap
      rowHeight = 0
    }
    positions.push({ ...dim, x, y })
    x += dim.width + gap
    rowHeight = Math.max(rowHeight, dim.height)
  })

  const totalWidth = positions.reduce((max, p) => Math.max(max, p.x + p.width), 0)
  const totalHeight = y + rowHeight

  return { positions, totalWidth, totalHeight }
}

// "Group by server"'s layout-algorithm picker (see MapView.vue) — 'topo'
// positions both servers among themselves and units within each server by
// relationship (a container's or VM's relationship is projected all the
// way up onto the servers hosting the two ends — see spec.js's
// buildServerTopologyEdges — so e.g. a web VM's server ends up near its
// database's server), while 'grid' is the map's original relationship-blind
// packing at both levels. A mix of the two (e.g. topological servers with
// grid-packed units) isn't offered — one algorithm for the whole mode is
// simpler to reason about, and there was no request for finer control.
//
// `granularity` is the same "Group by VM" axis the ungrouped view has —
// 'vm' (default) packs VMs into each server's box, 'container' packs the
// containers hosted on it directly instead, orthogonally to whichever
// algorithm is chosen. Server-to-server positioning is unaffected either
// way: buildServerTopologyEdges() already projects straight from raw
// container-level edges up to servers regardless of what's shown inside
// them.
export function computeMapLayout(tree, measuredSizes, algorithm = 'topo', granularity = 'vm') {
  const unitEdges = granularity === 'vm' ? buildTopologyEdges() : buildEdges()
  if (algorithm === 'grid') {
    const serverDims = tree.map((server) =>
      layoutServerGrid(server, unitsForServer(server, granularity, measuredSizes))
    )
    return shelfPack(serverDims, SERVER_GAP, MAX_ROW_WIDTH)
  }
  const serverDims = tree.map((server) =>
    layoutServerTopo(server, unitsForServer(server, granularity, measuredSizes), unitEdges)
  )
  return computeTopologicalLayout(serverDims, buildServerTopologyEdges())
}

// Longest-path layering: nodes with no incoming edge sit at layer 0, and
// everything else at 1 + the deepest layer of its predecessors. Standard
// left-to-right "Sugiyama-style" DAG layout, minus edge-crossing
// minimization within a layer (not needed at this graph's size). Kahn's
// algorithm underneath, so a cycle (shouldn't occur in this data, but
// nothing guarantees it won't) just leaves the cyclic nodes at their
// initial layer instead of looping forever. Generic over any node id — VMs
// and externals share this same graph.
function computeLayers(nodeIds, edges) {
  const layer = new Map(nodeIds.map((id) => [id, 0]))
  const outgoing = new Map(nodeIds.map((id) => [id, []]))
  const indegree = new Map(nodeIds.map((id) => [id, 0]))
  const seen = new Set()

  for (const edge of edges) {
    if (!outgoing.has(edge.from) || !outgoing.has(edge.to)) continue
    const key = `${edge.from}=>${edge.to}`
    if (seen.has(key)) continue
    seen.add(key)
    outgoing.get(edge.from).push(edge.to)
    indegree.set(edge.to, indegree.get(edge.to) + 1)
  }

  const remaining = new Map(indegree)
  const queue = nodeIds.filter((id) => remaining.get(id) === 0)
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    for (const next of outgoing.get(id)) {
      layer.set(next, Math.max(layer.get(next), layer.get(id) + 1))
      remaining.set(next, remaining.get(next) - 1)
      if (remaining.get(next) === 0) queue.push(next)
    }
  }

  return layer
}

// Undirected adjacency (both directions) over edges whose endpoints are
// both known ids — shared by the ordering and positioning passes below.
function buildNeighborMap(edges, dimById) {
  const neighborsOf = new Map()
  for (const e of edges) {
    if (!dimById.has(e.from) || !dimById.has(e.to)) continue
    if (!neighborsOf.has(e.from)) neighborsOf.set(e.from, [])
    if (!neighborsOf.has(e.to)) neighborsOf.set(e.to, [])
    neighborsOf.get(e.from).push(e.to)
    neighborsOf.get(e.to).push(e.from)
  }
  return neighborsOf
}

function* permutations(arr) {
  if (arr.length <= 1) {
    yield arr
    return
  }
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)]
    for (const p of permutations(rest)) yield [arr[i], ...p]
  }
}

// Reorders each column's ids to minimize total edge length: coordinate
// descent over columns, each optimized exactly by brute-force permutation
// search (columns here are small — a heuristic like barycenter risks
// converging to a worse arrangement than it started with, since box
// heights vary a lot with container count, so "pull toward the average
// rank of your neighbors" doesn't track real pixel position well; brute
// force sidesteps that by directly comparing real vertical distance).
// Holding every other column's y-positions fixed, only the vertical
// component of edge length depends on this column's internal order (x is
// already fixed per column), so minimizing that is minimizing this
// column's contribution to total edge length exactly. A few sweeps let
// each column adapt to its neighbors' latest arrangement. Only the
// vertical order changes; x per column, and the stacking that guarantees
// no overlap and even gaps, are untouched.
function orderForMinimalEdgeLength(byLayer, edges, gap) {
  const MAX_BRUTE_FORCE_COLUMN = 7 // 7! = 5040 — negligible, and larger than any column here
  const SWEEPS = 3

  const layerKeys = [...byLayer.keys()].sort((a, b) => a - b)
  const order = new Map(layerKeys.map((l) => [l, byLayer.get(l).map((dim) => dim.id)]))
  const dimById = new Map()
  layerKeys.forEach((l) => byLayer.get(l).forEach((dim) => dimById.set(dim.id, dim)))
  const neighborsOf = buildNeighborMap(edges, dimById)

  function centerYById(currentOrder) {
    const centerY = new Map()
    for (const l of layerKeys) {
      let y = 0
      for (const id of currentOrder.get(l)) {
        const dim = dimById.get(id)
        centerY.set(id, y + dim.height / 2)
        y += dim.height + gap
      }
    }
    return centerY
  }

  // Vertical-distance cost of one column's arrangement against every
  // neighbor's CURRENT center (elsewhere in the graph, held fixed).
  function arrangementCost(arrangement, centerY) {
    let y = 0
    let cost = 0
    for (const id of arrangement) {
      const dim = dimById.get(id)
      const myY = y + dim.height / 2
      for (const n of neighborsOf.get(id) || []) cost += Math.abs(myY - centerY.get(n))
      y += dim.height + gap
    }
    return cost
  }

  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    for (const l of layerKeys) {
      const ids = order.get(l)
      if (ids.length <= 1 || ids.length > MAX_BRUTE_FORCE_COLUMN) continue
      // This column's own members don't count toward its own cost — only
      // their fixed positions elsewhere matter as targets.
      const centerY = centerYById(order)
      let best = ids
      let bestCost = arrangementCost(ids, centerY)
      for (const candidate of permutations(ids)) {
        const cost = arrangementCost(candidate, centerY)
        if (cost < bestCost) {
          bestCost = cost
          best = candidate
        }
      }
      order.set(l, best)
    }
  }

  return order
}

// Given each column's fixed vertical order (from orderForMinimalEdgeLength
// — this doesn't reorder anything), assigns actual y-centers that pull
// each node toward the average position of what it connects to. Distinct
// from ordering: two nodes might already be in the best possible order and
// still sit far from their targets simply because their neighbors aren't
// evenly spaced, so the fix is spacing, not reshuffling. Overlap is
// resolved by pushing a node down only as far as the minimum gap from the
// one before it requires — columns may end up with bigger-than-minimum
// gaps where that helps alignment, but never a smaller one. A fixed,
// small number of sweeps (alternating direction so influence propagates
// both ways) is deliberate, not merely "enough passes to converge": two
// nodes in genuinely disconnected parts of the graph that happen to share
// a column have no edge pulling them toward each other, so their relative
// offset costs nothing either way — nothing stops that gap from growing
// with each extra sweep (it did, in testing: 50 sweeps produced a far
// bigger gap than 4, with IDENTICAL total edge length, confirming it was
// pure unconstrained drift, not slow convergence). compactGaps below is
// what actually resolves that kind of gap correctly.
function positionForAlignment(order, layerKeys, dimById, neighborsOf, gap) {
  const centerY = new Map()
  for (const l of layerKeys) {
    let y = 0
    for (const id of order.get(l)) {
      const dim = dimById.get(id)
      centerY.set(id, y + dim.height / 2)
      y += dim.height + gap
    }
  }

  const SWEEPS = 6
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    const keysThisSweep = sweep % 2 === 0 ? layerKeys : [...layerKeys].reverse()
    for (const l of keysThisSweep) {
      const ids = order.get(l)
      const targets = ids.map((id) => {
        const neighborIds = neighborsOf.get(id)
        if (!neighborIds?.length) return centerY.get(id)
        return neighborIds.reduce((sum, n) => sum + centerY.get(n), 0) / neighborIds.length
      })
      let prevBottom = null
      ids.forEach((id, i) => {
        const dim = dimById.get(id)
        const minCenter = prevBottom === null ? -Infinity : prevBottom + gap + dim.height / 2
        const y = Math.max(targets[i], minCenter)
        centerY.set(id, y)
        prevBottom = y + dim.height / 2
      })
    }
  }

  return centerY
}

// The sweeps above only ever push a node DOWN to satisfy the minimum gap,
// so a gap can end up bigger than alignment needs — most visibly between
// two genuinely disconnected parts of the graph that happen to share a
// column: nothing pulls them toward each other, so their relative offset
// is a free variable the sweeps can drift arbitrarily (cost-free either
// way, so nothing corrects it). This closes any gap bigger than the
// minimum by rigidly shifting everything below it up — but by exactly the
// right amount, not just "as much as possible": shifting a group by `s`
// changes each of its members' distance to every neighbor OUTSIDE the
// group (internal distances are shift-invariant), so the total of those
// distances as a function of `s` is a sum of |constant - s| terms — an L1
// cost, minimized exactly at the MEDIAN of those constants (the standard
// result for "one point minimizing summed absolute distance to several
// others"). Clamped to [0, slack] since compaction should only ever
// close a gap, never widen one or overshoot past the minimum. Mutates
// `centerY` in place.
function compactGaps(order, layerKeys, dimById, neighborsOf, centerY, gap) {
  for (const l of layerKeys) {
    const ids = order.get(l)
    for (let i = 1; i < ids.length; i++) {
      const prevDim = dimById.get(ids[i - 1])
      const prevBottom = centerY.get(ids[i - 1]) + prevDim.height / 2
      const curDim = dimById.get(ids[i])
      const curTop = centerY.get(ids[i]) - curDim.height / 2
      const slack = curTop - prevBottom - gap
      if (slack <= 0.001) continue

      const tail = ids.slice(i)
      const tailSet = new Set(tail)
      const boundaryOffsets = []
      for (const id of tail) {
        for (const n of neighborsOf.get(id) || []) {
          if (!tailSet.has(n)) boundaryOffsets.push(centerY.get(id) - centerY.get(n))
        }
      }

      let shift
      if (!boundaryOffsets.length) {
        shift = slack // Nothing outside the tail cares where it sits — collapse fully.
      } else {
        boundaryOffsets.sort((a, b) => a - b)
        const median = boundaryOffsets[Math.floor(boundaryOffsets.length / 2)]
        shift = Math.min(Math.max(median, 0), slack)
      }

      if (shift > 0.001) {
        for (const id of tail) centerY.set(id, centerY.get(id) - shift)
      }
    }
  }
}

// Weakly-connected components (undirected) among `ids`, restricted to
// edges whose both ends are in `ids`. Two components have no edge between
// them by definition — nothing to align them against each other — so
// laying each out independently (its own columns) is what lets
// computeFlatMapLayout avoid ever inventing an arbitrary gap between
// unrelated things by accidentally sharing a column.
function findComponents(ids, edges) {
  const idSet = new Set(ids)
  const adjacency = new Map(ids.map((id) => [id, []]))
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue
    adjacency.get(e.from).push(e.to)
    adjacency.get(e.to).push(e.from)
  }

  const seen = new Set()
  const components = []
  for (const start of ids) {
    if (seen.has(start)) continue
    const component = [start]
    seen.add(start)
    for (let i = 0; i < component.length; i++) {
      for (const neighbor of adjacency.get(component[i])) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor)
          component.push(neighbor)
        }
      }
    }
    components.push(component)
  }
  return components
}

// Nodes (any mix of 'vm'/'container'/'external'-kinded dims — see
// layoutVm/layoutContainerNode/layoutExternalNode) plus the edges between
// them, positioned by relationship depth — generic over what the nodes
// actually represent, which is what lets computeFlatMapLayout and
// computeContainerMapLayout below share every bit of this logic and differ
// only in which nodes/edges they hand it (VMs+buildTopologyEdges() vs.
// containers+buildEdges() directly).
//
// An edge from an 'external' node doesn't mean "comes after" the way a
// real dependency edge does — it's more like "this is where traffic
// enters" — so it mustn't affect layer depth the way a real edge does
// (that would need to cascade to the target's own dependents too, which a
// simple depth bump doesn't do, and can silently produce a same-column,
// zero-length edge for anything downstream of the bumped node). So depth
// is computed from non-external edges only; externals are then rendered
// in their own fixed column ahead of everything else, regardless of which
// layer their targets landed at — a display convention, not something the
// dependency graph requires.
//
// Each weakly-connected component (see findComponents) is laid out in its
// own independent band, stacked vertically — not because that's visually
// necessary, but because giving two unrelated components the same column
// space (e.g. both happening to have a layer-0 node) has no edge to hold
// their relative vertical offset in place, so it ends up arbitrary and,
// worse, un-anchored drift the alignment sweeps can grow without bound.
function computeTopologicalLayout(nodes, edges) {
  const dimsById = new Map(nodes.map((n) => [n.id, n]))

  const connected = new Set()
  edges.forEach((e) => {
    connected.add(e.from)
    connected.add(e.to)
  })

  const allIds = nodes.map((n) => n.id)
  const connectedIds = allIds.filter((id) => connected.has(id))
  const unconnectedIds = allIds.filter((id) => !connected.has(id))

  const vmOnlyEdges = edges.filter(
    (e) => dimsById.get(e.from).kind !== 'external' && dimsById.get(e.to).kind !== 'external'
  )
  const neighborsOf = buildNeighborMap(edges, dimsById)
  const components = findComponents(connectedIds, edges)

  const topoPositions = []
  let topoWidth = 0
  let bandY = 0
  for (const component of components) {
    const layers = computeLayers(component, vmOnlyEdges)

    const byLayer = new Map()
    component.forEach((id) => {
      const dim = dimsById.get(id)
      const l = dim.kind === 'external' ? -1 : layers.get(id)
      if (!byLayer.has(l)) byLayer.set(l, [])
      byLayer.get(l).push(dim)
    })

    const order = orderForMinimalEdgeLength(byLayer, edges, VM_GAP)
    const layerKeys = [...order.keys()].sort((a, b) => a - b)

    // Column x/width first — independent of vertical placement, since a
    // column's width is just the widest thing in it regardless of order.
    const colX = new Map()
    let x = 0
    for (const l of layerKeys) {
      const width = Math.max(...order.get(l).map((id) => dimsById.get(id).width))
      colX.set(l, x)
      x += width + COLUMN_GAP
    }
    topoWidth = Math.max(topoWidth, x - COLUMN_GAP)

    const centerY = positionForAlignment(order, layerKeys, dimsById, neighborsOf, VM_GAP)
    compactGaps(order, layerKeys, dimsById, neighborsOf, centerY, VM_GAP)

    let minTop = Infinity
    let maxBottom = -Infinity
    component.forEach((id) => {
      const dim = dimsById.get(id)
      const top = centerY.get(id) - dim.height / 2
      minTop = Math.min(minTop, top)
      maxBottom = Math.max(maxBottom, top + dim.height)
    })

    component.forEach((id) => {
      const dim = dimsById.get(id)
      const l = dim.kind === 'external' ? -1 : layers.get(id)
      topoPositions.push({
        ...dim,
        x: colX.get(l),
        y: centerY.get(id) - dim.height / 2 - minTop + bandY,
      })
    })

    bandY += maxBottom - minTop + SERVER_GAP
  }
  const topoHeight = Math.max(0, bandY - SERVER_GAP)

  const unconnectedDims = unconnectedIds.map((id) => dimsById.get(id))
  const shelfY = topoHeight > 0 ? topoHeight + SERVER_GAP : 0
  const shelf = shelfPack(unconnectedDims, VM_GAP, Math.max(topoWidth, MAX_ROW_WIDTH))
  const shelfPositions = shelf.positions.map((p) => ({ ...p, y: p.y + shelfY }))

  return {
    positions: [...topoPositions, ...shelfPositions],
    totalWidth: Math.max(topoWidth, shelf.totalWidth),
    totalHeight: shelfY + shelf.totalHeight,
    topoHeight,
    hasUnconnected: unconnectedIds.length > 0,
  }
}

// Same VMs and containers, but without server grouping, plus `externals`
// (e.g. "live traffic") — used to pull a VM into the graph (e.g. out of
// "no direct relationships") without acting as a real dependency hop.
export function computeFlatMapLayout(tree, externals = [], measuredSizes) {
  const vms = tree.flatMap((server) => server.vms)
  const nodes = [
    ...vms.map((vm) => layoutVm(vm, measuredSizes.get(vm.id))),
    ...externals.map(layoutExternalNode),
  ]
  return computeTopologicalLayout(nodes, buildTopologyEdges())
}

// Backs the "Group by VM" toggle unchecked: the exact same topological
// algorithm as computeFlatMapLayout, but with containers themselves as the
// positioned nodes instead of the VMs hosting them — VM boxes disappear
// entirely, and every container (pgbouncer, memcached, nginx, ...) becomes
// its own node wired up by its *own* relationships. Simpler than the VM
// case in one way: containers are already the graph's real unit, so this
// uses buildEdges() directly with no VM-projection step.
export function computeContainerMapLayout(containers, externals = [], measuredSizes) {
  const nodes = [
    ...containers.map((c) => layoutContainerNode(c, measuredSizes.get(c.id))),
    ...externals.map(layoutExternalNode),
  ]
  return computeTopologicalLayout(nodes, buildEdges())
}

// Absolute (world-coordinate) box for every server and unit (VM or
// container, depending on "Group by VM" — see computeMapLayout's
// `granularity`) id, plus each VM's own containers when applicable — what
// relationship edges attach to, regardless of which level they connect.
export function flattenLayout(layout) {
  const boxes = new Map()
  for (const s of layout.positions) {
    boxes.set(s.server.id, { x: s.x, y: s.y, width: s.width, height: s.height })
    for (const up of s.unitPositions) {
      const ux = s.x + up.x
      const uy = s.y + up.y
      boxes.set(up.id, { x: ux, y: uy, width: up.width, height: up.height })
      if (up.kind !== 'vm') continue
      for (const cp of up.containerPositions) {
        boxes.set(cp.container.id, {
          x: ux + cp.x,
          y: uy + cp.y,
          width: cp.width,
          height: cp.height,
        })
      }
    }
  }
  return boxes
}

// Same as flattenLayout, but for computeFlatMapLayout's output — a mix of
// top-level VM and external nodes (no server wrapper to descend through).
// Only VM nodes have containers to descend into.
export function flattenFlatLayout(layout) {
  const boxes = new Map()
  for (const node of layout.positions) {
    boxes.set(node.id, { x: node.x, y: node.y, width: node.width, height: node.height })
    if (node.kind !== 'vm') continue
    for (const cp of node.containerPositions) {
      boxes.set(cp.container.id, {
        x: node.x + cp.x,
        y: node.y + cp.y,
        width: cp.width,
        height: cp.height,
      })
    }
  }
  return boxes
}

// Every layout here flows left-to-right (x increases with dependency
// order), so relationship edges always leave a box's right side and arrive
// at the target's left side — a fixed anchor per side, rather than
// wherever a ray to the other box's center happens to exit, keeps arrows
// visually consistent instead of poking out of arbitrary sides depending
// on how two boxes happen to be vertically offset from each other.
//
// When several edges share a side of the same box, `count` fans them out
// evenly across it instead of bunching them all at the midpoint: dividing
// the height into count+1 equal segments and placing a point at each
// internal boundary keeps them symmetric around the center and off the
// corners, for any count — count=1 lands exactly on the midpoint, same as
// before.
function distributeAlongSide(box, count, xForSide) {
  const points = []
  for (let i = 0; i < count; i++) {
    points.push({ x: xForSide(box), y: box.y + (box.height * (i + 1)) / (count + 1) })
  }
  return points
}

export function rightSidePoints(box, count) {
  return distributeAlongSide(box, count, (b) => b.x + b.width)
}

export function leftSidePoints(box, count) {
  return distributeAlongSide(box, count, (b) => b.x)
}
