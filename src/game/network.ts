/** Pure graph-algorithm functions for the transmission/distribution network — no scene
 * coupling, no Three.js dependency, matching `catenary.ts`'s precedent of hand-written
 * math living in its own scene-independent module. `Game.buildNetworkGraph()` is the
 * only place that translates live entities into the `NetworkGraph` shape these
 * functions read. */

export type NodeKind = 'plant' | 'tower' | 'substation' | 'neighborhood';
export type EdgeKind = 'transmission' | 'distribution';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  /** Plant: effective (capacity-factor-adjusted) generation output — seeded as this
   * node's starting bottleneck in `computeMaxBottleneck`. Substation: its throughput
   * ceiling. Tower/Neighborhood: `Infinity` — uncapped pass-through/sink, per the "no
   * separate MW cap on Towers" design decision (PLAN.md). */
  capacityMW: number;
}

export interface GraphEdge {
  a: string;
  b: string;
  kind: EdgeKind;
  capacityMW: number;
}

export interface NetworkGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface AdjacencyEdge {
  to: string;
  capacityMW: number;
}

function buildAdjacency(graph: NetworkGraph, kindFilter?: EdgeKind): Map<string, AdjacencyEdge[]> {
  const adjacency = new Map<string, AdjacencyEdge[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) {
    if (kindFilter && edge.kind !== kindFilter) continue;
    adjacency.get(edge.a)?.push({ to: edge.b, capacityMW: edge.capacityMW });
    adjacency.get(edge.b)?.push({ to: edge.a, capacityMW: edge.capacityMW });
  }
  return adjacency;
}

/**
 * Multi-source widest-path (maximum bottleneck capacity): for every node, finds the
 * best achievable bottleneck capacity along any path from any of `sourceIds`. This is
 * the standard "maximum capacity path" graph problem — Dijkstra-shaped, but relaxing by
 * `min(...)` and always keeping the *largest* candidate seen, not the shortest distance.
 * Node throughput limits (a Substation's `capacityMW`) are folded in during relaxation
 * by capping the candidate bottleneck at each node visited, not as a separate pass.
 *
 * A simple "extract max from an array" queue is used deliberately over a binary heap —
 * this graph is tens of nodes/edges in real play, so an O(V^2) scan is not a measurable
 * cost, and it's simpler for no real benefit at this scale.
 */
export function computeMaxBottleneck(graph: NetworkGraph, sourceIds: string[]): Map<string, number> {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const adjacency = buildAdjacency(graph);

  const bottleneck = new Map<string, number>();
  for (const node of graph.nodes) bottleneck.set(node.id, 0);

  const frontier: { id: string; value: number }[] = [];
  for (const sourceId of sourceIds) {
    const node = nodeById.get(sourceId);
    if (!node) continue;
    bottleneck.set(sourceId, node.capacityMW);
    frontier.push({ id: sourceId, value: node.capacityMW });
  }

  const settled = new Set<string>();
  while (frontier.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < frontier.length; i++) {
      if (frontier[i].value > frontier[bestIdx].value) bestIdx = i;
    }
    const { id, value } = frontier.splice(bestIdx, 1)[0];
    if (settled.has(id)) continue;
    settled.add(id);

    for (const edge of adjacency.get(id) ?? []) {
      const neighbor = nodeById.get(edge.to);
      if (!neighbor) continue;
      const candidate = Math.min(value, edge.capacityMW, neighbor.capacityMW);
      if (candidate > (bottleneck.get(edge.to) ?? 0)) {
        bottleneck.set(edge.to, candidate);
        frontier.push({ id: edge.to, value: candidate });
      }
    }
  }

  return bottleneck;
}

/**
 * Substation-disjoint N-1 redundancy: true iff `substationId` has two paths reaching a
 * Plant that don't share any *other* Substation. This is the cheap, textbook way to
 * compute "are there 2 vertex-disjoint paths" (Menger's theorem / max-flow value 2) —
 * two BFS passes, the second excluding every Substation the first pass used — rather
 * than a general max-flow solver. This is literally how NERC N-1 contingency analysis
 * conceptually works: remove one element, check connectivity still holds.
 *
 * Only transmission-kind edges participate — distribution spans/Neighborhoods are never
 * part of the transmission-side redundancy question, matching the plan's topology
 * decision (a Neighborhood's own N-1 status is entirely a question of whether *its*
 * Substation has two disjoint transmission paths to generation).
 */
function edgeKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export function isSubstationRedundant(graph: NetworkGraph, substationId: string): boolean {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const transmissionEdges = graph.edges.filter((e) => e.kind === 'transmission');

  const findPathToPlant = (excludeSubstations: Set<string>, excludeEdges: Set<string>): string[] | null => {
    const adjacency = new Map<string, string[]>();
    for (const node of graph.nodes) adjacency.set(node.id, []);
    for (const edge of transmissionEdges) {
      if (excludeEdges.has(edgeKey(edge.a, edge.b))) continue;
      adjacency.get(edge.a)?.push(edge.b);
      adjacency.get(edge.b)?.push(edge.a);
    }

    const cameFrom = new Map<string, string | null>();
    cameFrom.set(substationId, null);
    const queue: string[] = [substationId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (nodeById.get(current)?.kind === 'plant') {
        const path: string[] = [];
        let node: string | null = current;
        while (node !== null) {
          path.unshift(node);
          node = cameFrom.get(node) ?? null;
        }
        return path;
      }

      for (const next of adjacency.get(current) ?? []) {
        if (cameFrom.has(next)) continue;
        const neighbor = nodeById.get(next);
        if (neighbor?.kind === 'substation' && next !== substationId && excludeSubstations.has(next)) continue;
        cameFrom.set(next, current);
        queue.push(next);
      }
    }
    return null;
  };

  const firstPath = findPathToPlant(new Set(), new Set());
  if (!firstPath) return false;

  const usedSubstations = new Set(
    firstPath.filter((id) => id !== substationId && nodeById.get(id)?.kind === 'substation'),
  );
  // Exclude the first path's own edges too, not just the substations along it — a
  // substation with only one physical edge leaving it has at most one possible path
  // regardless of how many (zero) intermediate substations that edge happens to pass
  // through, and substation-exclusion alone can't detect that degenerate case.
  const usedEdges = new Set<string>();
  for (let i = 0; i < firstPath.length - 1; i++) {
    usedEdges.add(edgeKey(firstPath[i], firstPath[i + 1]));
  }

  const secondPath = findPathToPlant(usedSubstations, usedEdges);
  return secondPath !== null;
}
