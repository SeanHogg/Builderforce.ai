/**
 * The BOUND on a knowledge graph before it leaves the build (worker or in-thread): the node count is capped by the build
 * (`MAX_NODES_CAP`), but the edges and findings scale with the repository (a 6k-file repo: 120k `references` edges, 24k
 * `partition-violation` findings) and the whole graph is then structured-cloned worker → host, JSON'd for last-seen and
 * posted to the webview. Everything the view cannot use is cut HERE, once:
 *
 *   1. edges: dropped when an endpoint is not a kept node, parallel (from, to, kind) edges merged into ONE (`weight` summed,
 *      the worst `verdict`, `cycle` kept), then capped at {@link MAX_GRAPH_EDGES} — calls/uses/extends/implements/composes/
 *      contains first, `references` last, the heaviest first within a class;
 *   2. findings: `partition-violation` is per-edge noise, so it folds into ONE finding per (verdict, layer pair, source area →
 *      target area) with `params.count` (the true number) and its first {@link PARTITION_SAMPLES} file pairs as `nodes`;
 *   3. payload: a count-based size estimate ({@link estimatedPayloadBytes}, never a JSON of the graph); over
 *      {@link MAX_GRAPH_PAYLOAD_BYTES} the edges, then the findings, are halved again until it fits.
 *
 * `stats.nodes` / `stats.edges` stay the TRUE totals; what was cut is `stats.bounds` ({@link GraphBounds}: counts and the
 * human reasons, for the diagnostics and the load trace). Pure: no I/O, no `vscode`. Worker-safe.
 */

import type { Finding, KEdge, KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";

/** Most edges one graph carries to the host and the webview (6 per node of the 2000-node cap; a canvas draws this smoothly). */
export const MAX_GRAPH_EDGES = 12_000;
/** Most findings one graph carries (errors first). */
export const MAX_GRAPH_FINDINGS = 5_000;
/** Most aggregated `partition-violation` findings: the heaviest (area → area) groups. */
export const MAX_PARTITION_GROUPS = 400;
/** File pairs a folded `partition-violation` keeps as `nodes` (the examples a drawer lists). */
export const PARTITION_SAMPLES = 3;
/** The estimated size of one graph payload (the host holds it, the webview receives it); past it the graph is trimmed further. */
export const MAX_GRAPH_PAYLOAD_BYTES = 24 * 1024 * 1024;

/** Estimated JSON bytes per node, edge, finding, outline file and outline link (measured on real graphs, rounded up). */
const NODE_BYTES = 700, EDGE_BYTES = 260, FINDING_BYTES = 650, OUTLINE_FILE_BYTES = 220, OUTLINE_LINK_BYTES = 30;
/** Call sites one merged `calls` edge keeps. */
const MAX_SITES = 50;

/** The limits a bound applies; the defaults are the constants above (a test passes smaller ones). */
export interface GraphLimits { edges: number; findings: number; partitionGroups: number; payloadBytes: number }
export const DEFAULT_GRAPH_LIMITS: GraphLimits = {
  edges: MAX_GRAPH_EDGES, findings: MAX_GRAPH_FINDINGS, partitionGroups: MAX_PARTITION_GROUPS, payloadBytes: MAX_GRAPH_PAYLOAD_BYTES,
};

/** What a bound cut, as `stats.bounds`. `total*` are what the build produced; the rest is what the graph carries. */
export interface GraphBounds {
  edges: { total: number; kept: number; dangling: number; merged: number; capped: number };
  findings: { total: number; kept: number; partitionViolations: number; partitionGroups: number };
  payload: { estimatedBytes: number; budgetBytes: number; trimmed: boolean };
  /** Why the graph carries fewer edges/findings than it was built with: the diagnostics' truncation reasons. */
  reasons: string[];
}

export type BoundedStats = KnowledgeGraph["stats"] & { bounds?: GraphBounds };

const PARTITION_VIOLATION = "partition-violation";
/** Edge kinds that carry design information; `references` (a file imports a file) is the bulk and goes last. */
const STRUCTURAL = new Set(["calls", "uses", "extends", "implements", "composes", "contains"]);
const VERDICT_RANK: Record<string, number> = { allowed: 0, same: 1, skips: 2, upward: 3 };

const priorityOf = (kind: string): number => (STRUCTURAL.has(kind) ? 0 : kind === "references" ? 2 : 1);

/** ONE (from, to, kind) edge for the parallel ones: summed weight, worst verdict, cycle if any, call sites in order (capped). */
function merge(into: KEdge, e: KEdge): void {
  into.weight += e.weight;
  if (e.verdict && (VERDICT_RANK[e.verdict] ?? 0) > (VERDICT_RANK[into.verdict ?? "allowed"] ?? 0)) into.verdict = e.verdict;
  if (e.cycle) into.cycle = true;
  if (e.stale) into.stale = true;
  if (e.sites && into.sites && into.sites.length < MAX_SITES) into.sites = [...into.sites, ...e.sites].slice(0, MAX_SITES);
}

interface EdgeOutcome { edges: KEdge[]; dangling: number; merged: number }

/** The edges both of whose endpoints are kept nodes, parallel ones merged (first-seen order kept). */
function resolveEdges(graph: KnowledgeGraph): EdgeOutcome {
  const kept = new Set<string>(graph.nodes.map((n) => n.ref));
  const byKey = new Map<string, KEdge>();
  let dangling = 0, merged = 0;
  for (const e of graph.edges) {
    if (!kept.has(e.from) || !kept.has(e.to)) { dangling++; continue; }
    const key = `${e.from}\u0000${e.to}\u0000${e.kind}`;
    const held = byKey.get(key);
    if (held) { merge(held, e); merged++; } else byKey.set(key, { ...e, ...(e.sites ? { sites: [...e.sites] } : {}) });
  }
  return { edges: [...byKey.values()], dangling, merged };
}

/** The `max` best edges (structural kinds first, heaviest first), in their original order. */
export function capEdges(edges: readonly KEdge[], max: number): KEdge[] {
  if (edges.length <= max) return [...edges];
  const order = edges.map((e, i) => ({ i, p: priorityOf(e.kind), w: e.weight }));
  order.sort((a, b) => a.p - b.p || b.w - a.w || a.i - b.i);
  return order.slice(0, Math.max(0, max)).map((o) => o.i).sort((a, b) => a - b).map((i) => edges[i]!);
}

/** `src:root::api/src/domain/x.ts` → `api/src/domain`: the file's directory, to three levels (the "area" a violation is between). */
export function areaPathOf(ref: string): string {
  const at = ref.indexOf("::");
  const path = at >= 0 ? ref.slice(at + 2) : ref;
  const dirs = path.split("/").slice(0, -1);
  return dirs.slice(0, 3).join("/");
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** Folds every `partition-violation` into one finding per (verdict, layer pair, source area → target area); the rest stay as they are. */
export function foldPartitionViolations(findings: readonly Finding[], maxGroups: number): { findings: Finding[]; violations: number; groups: number } {
  const groups = new Map<string, { first: Finding; count: number; nodes: Finding["nodes"]; fromArea: string; toArea: string }>();
  const rest: Finding[] = [];
  let violations = 0;
  for (const f of findings) {
    if (f.kind !== PARTITION_VIOLATION) { rest.push(f); continue; }
    violations += Number(f.params.count) || 1; // an already-folded finding carries its own count
    const [from, to] = f.nodes;
    const fromArea = from ? areaPathOf(from) : "", toArea = to ? areaPathOf(to) : "";
    const key = `${f.params.verdict === "upward" ? "upward" : "skips"}:${text(f.params.from)}>${text(f.params.to)}:${fromArea}>${toArea}`;
    let g = groups.get(key);
    if (!g) { g = { first: f, count: 0, nodes: [], fromArea, toArea }; groups.set(key, g); }
    g.count += Number(f.params.count) || 1;
    if (g.nodes.length < PARTITION_SAMPLES * 2) g.nodes = [...g.nodes, ...f.nodes.slice(0, 2)];
  }
  const folded = [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1))
    .slice(0, maxGroups)
    .map(([key, g]): Finding => ({
      ...g.first,
      id: `${PARTITION_VIOLATION}:${key}`,
      nodes: g.nodes,
      params: { ...g.first.params, count: g.count, fromArea: g.fromArea, toArea: g.toArea },
      anchor: `${text(g.first.params.from)}->${text(g.first.params.to)}@${g.fromArea}>${g.toArea}`,
      anchorKind: "group",
    }));
  return { findings: [...rest, ...folded], violations, groups: groups.size };
}

const SEVERITY_RANK: Record<string, number> = { error: 0, warn: 1, info: 2 };

/** The `max` most severe findings, in their original order. */
function capFindings(findings: readonly Finding[], max: number): Finding[] {
  if (findings.length <= max) return [...findings];
  const order = findings.map((f, i) => ({ i, s: SEVERITY_RANK[f.severity] ?? 3 }));
  order.sort((a, b) => a.s - b.s || a.i - b.i);
  return order.slice(0, Math.max(0, max)).map((o) => o.i).sort((a, b) => a - b).map((i) => findings[i]!);
}

/** The size the graph's payload will be, from COUNTS (never a JSON of the graph: that is the cost this guard avoids). */
export function estimatedPayloadBytes(g: Pick<KnowledgeGraph, "nodes" | "edges" | "findings" | "outline">): number {
  return g.nodes.length * NODE_BYTES + g.edges.length * EDGE_BYTES + g.findings.length * FINDING_BYTES
    + (g.outline ? g.outline.files.length * OUTLINE_FILE_BYTES + g.outline.links.length * OUTLINE_LINK_BYTES : 0);
}

/** The bounded graph: see the module doc. Returns a new graph; the input is not changed. */
export function boundGraph(graph: KnowledgeGraph, limits: GraphLimits = DEFAULT_GRAPH_LIMITS): KnowledgeGraph {
  const totalEdges = graph.edges.length, totalFindings = graph.findings.length;
  const { edges: resolved, dangling, merged } = resolveEdges(graph);
  const folded = foldPartitionViolations(graph.findings, limits.partitionGroups);
  let edges = capEdges(resolved, limits.edges);
  let findings = capFindings(folded.findings, limits.findings);
  const reasons: string[] = [];

  let bytes = estimatedPayloadBytes({ nodes: graph.nodes, edges, findings, ...(graph.outline ? { outline: graph.outline } : {}) });
  let trimmed = false;
  // Over budget: halve the edges, then the findings, until it fits (bounded: each step halves, so a handful of rounds).
  for (let round = 0; bytes > limits.payloadBytes && round < 24 && (edges.length > 0 || findings.length > 0); round++) {
    trimmed = true;
    if (edges.length > 0) edges = capEdges(edges, Math.floor(edges.length / 2));
    else findings = capFindings(findings, Math.floor(findings.length / 2));
    bytes = estimatedPayloadBytes({ nodes: graph.nodes, edges, findings, ...(graph.outline ? { outline: graph.outline } : {}) });
  }

  const capped = resolved.length - edges.length;
  if (dangling > 0 || capped > 0) {
    reasons.push(capped > 0
      ? `edges capped (${edges.length} of ${totalEdges} kept: ${dangling} ended outside the drawn nodes, ${capped} lightest dropped)`
      : `edges outside the drawn nodes dropped (${edges.length} of ${totalEdges} kept)`);
  }
  if (folded.violations > folded.groups) reasons.push(`partition violations folded (${folded.violations} into ${Math.min(folded.groups, limits.partitionGroups)} area pairs)`);
  if (findings.length < folded.findings.length) reasons.push(`findings capped (${findings.length} of ${folded.findings.length} kept, errors first)`);
  if (trimmed) reasons.push(`payload trimmed to fit ${Math.round(limits.payloadBytes / (1024 * 1024))} MB (estimated ${Math.round(bytes / 1024)} KB)`);

  const bounds: GraphBounds = {
    edges: { total: totalEdges, kept: edges.length, dangling, merged, capped },
    findings: { total: totalFindings, kept: findings.length, partitionViolations: folded.violations, partitionGroups: folded.groups },
    payload: { estimatedBytes: bytes, budgetBytes: limits.payloadBytes, trimmed },
    reasons,
  };
  const stats: BoundedStats = { ...graph.stats, bounds };
  return { ...graph, edges, findings, stats };
}

/** The one-line trace form of a bound (`Copy diagnostics`): `edges=123843>12000 findings=24739>412 pv=24674>312 payload~6291KB`. */
export function boundsLine(b: GraphBounds): string {
  const parts = [`edges=${b.edges.total}>${b.edges.kept}`, `findings=${b.findings.total}>${b.findings.kept}`];
  if (b.findings.partitionViolations > 0) parts.push(`pv=${b.findings.partitionViolations}>${b.findings.partitionGroups}`);
  parts.push(`payload~${Math.round(b.payload.estimatedBytes / 1024)}KB`);
  if (b.payload.trimmed) parts.push("payloadTrimmed");
  return parts.join(" ");
}

/** The bounds a graph carries, when it was bounded. */
export const boundsOf = (graph: KnowledgeGraph): GraphBounds | undefined => (graph.stats as BoundedStats).bounds;
