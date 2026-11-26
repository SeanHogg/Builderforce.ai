/**
 * The graph bound (`graphBudget.ts`): a 6k-file repository's graph (120k `references` edges, 20k `partition-violation`
 * findings, only 2000 nodes kept by the build) leaves the build under its caps, with the TRUE totals still reported.
 */
import { describe, expect, it } from "vitest";
import type { Finding, KEdge, KNode, KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";
import { boundGraph, boundsLine, boundsOf, capEdges, estimatedPayloadBytes, foldPartitionViolations, MAX_GRAPH_EDGES, MAX_GRAPH_FINDINGS, MAX_PARTITION_GROUPS, type GraphLimits } from "./graphBudget";

type Ref = KNode["ref"];
const AREAS = ["api/src/domain", "api/src/application", "api/src/infra", "web/src/ui", "web/src/lib", "cron/jobs", "lib/core", "lib/util"];
const LAYERS = ["domain", "application", "infrastructure", "presentation"];
const ref = (i: number): Ref => `src:sys::${AREAS[i % AREAS.length]}/f${i}.ts` as Ref;
const node = (i: number): KNode => ({ ref: ref(i), kind: "file", label: `f${i}.ts`, pack: "code", importance: 0.1, origin: "extracted" });
const edge = (from: number, to: number, kind = "references", weight = 1): KEdge => ({ from: ref(from), to: ref(to), kind, weight, origin: "extracted" });

/** 3000 files exist; the build kept the first 2000. 120k references edges across all 3000, plus a few calls. */
function syntheticGraph(): KnowledgeGraph {
  const nodes = Array.from({ length: 2000 }, (_, i) => node(i));
  const edges: KEdge[] = [];
  for (let i = 0; i < 120_000; i++) edges.push(edge(i % 3000, ((i % 3000) + 1 + Math.floor(i / 3000)) % 3000, "references", 1 + (i % 5))); // 40 distinct targets per file: no two alike
  for (let i = 0; i < 300; i++) edges.push(edge(i, i + 1, "calls", 1));
  const findings: Finding[] = [];
  for (let i = 0; i < 20_000; i++) {
    const from = i % 3000, to = (i * 13 + 5) % 3000;
    findings.push({
      id: `pv${i}`, kind: "partition-violation", pack: "code", nodes: [ref(from), ref(to)], severity: i % 3 === 0 ? "error" : "warn",
      params: { verdict: i % 3 === 0 ? "upward" : "skips", from: LAYERS[from % 4]!, to: LAYERS[to % 4]!, kind: "references" },
      requestKey: "knowledgeGraph.fix.partitionViolation",
    });
  }
  findings.push({ id: "gm", kind: "god-module", pack: "code", nodes: [ref(1)], severity: "warn", params: {} });
  return {
    scope: { rootId: "r", packs: ["code"], digest: "d" }, nodes, edges, findings,
    stats: { sources: 3000, nodes: 3000, edges: edges.length, stale: 0, truncated: true },
  };
}

describe("boundGraph: a large repository's graph", () => {
  const input = syntheticGraph();
  const out = boundGraph(input);
  const bounds = boundsOf(out)!;

  it("keeps edges under the cap, every one between kept nodes, and drops none of the structural kinds first", () => {
    expect(out.edges.length).toBeLessThanOrEqual(MAX_GRAPH_EDGES);
    const kept = new Set<string>(out.nodes.map((n) => n.ref));
    expect(out.edges.every((e) => kept.has(e.from) && kept.has(e.to))).toBe(true);
    expect(out.edges.filter((e) => e.kind === "calls").length).toBeGreaterThan(0);
  });

  it("folds the partition violations into one finding per layer pair and area pair, with the true count", () => {
    const pv = out.findings.filter((f) => f.kind === "partition-violation");
    expect(pv.length).toBeLessThanOrEqual(MAX_PARTITION_GROUPS);
    expect(pv.length).toBeLessThan(20_000 / 10);
    expect(pv.reduce((n, f) => n + Number(f.params.count), 0)).toBe(20_000 - 0);
    expect(pv[0]!.nodes.length).toBeLessThanOrEqual(6);
    expect(pv[0]!.params).toMatchObject({ fromArea: expect.any(String), toArea: expect.any(String), verdict: expect.any(String) });
    expect(out.findings.some((f) => f.kind === "god-module")).toBe(true);
    expect(out.findings.length).toBeLessThanOrEqual(MAX_GRAPH_FINDINGS);
  });

  it("keeps the TRUE totals in stats and says what was cut, with a reason for the edges", () => {
    expect(out.stats.edges).toBe(input.edges.length);
    expect(out.stats.nodes).toBe(3000);
    expect(bounds.edges.total).toBe(input.edges.length);
    expect(bounds.edges.kept).toBe(out.edges.length);
    expect(bounds.edges.dangling).toBeGreaterThan(0);
    expect(bounds.findings.total).toBe(20_001);
    expect(bounds.findings.partitionViolations).toBe(20_000);
    expect(bounds.reasons.some((r) => r.startsWith("edges capped"))).toBe(true);
    expect(bounds.reasons.some((r) => r.startsWith("partition violations folded"))).toBe(true);
    expect(boundsLine(bounds)).toContain(`edges=${input.edges.length}>${out.edges.length}`);
  });

  it("does not change its input", () => {
    expect(input.edges.length).toBe(120_300);
    expect(input.findings.length).toBe(20_001);
  });
});

describe("boundGraph: the payload guard", () => {
  it("trims further when the estimate is over budget, and records it", () => {
    const limits: GraphLimits = { edges: 12_000, findings: 5_000, partitionGroups: 400, payloadBytes: 2000 * 700 + 3_000 * 260 };
    const out = boundGraph(syntheticGraph(), limits);
    const b = boundsOf(out)!;
    expect(b.payload.trimmed).toBe(true);
    expect(estimatedPayloadBytes(out)).toBeLessThanOrEqual(limits.payloadBytes);
    expect(out.edges.length).toBeLessThanOrEqual(3_000);
    expect(b.reasons.some((r) => r.startsWith("payload trimmed"))).toBe(true);
  });

  it("leaves a small graph whole and untrimmed", () => {
    const small: KnowledgeGraph = {
      scope: { rootId: "r", packs: [], digest: "d" }, nodes: [node(0), node(1)], edges: [edge(0, 1)], findings: [],
      stats: { sources: 2, nodes: 2, edges: 1, stale: 0, truncated: false },
    };
    const out = boundGraph(small);
    expect(out.edges).toEqual(small.edges);
    expect(boundsOf(out)!.reasons).toEqual([]);
    expect(boundsOf(out)!.payload.trimmed).toBe(false);
  });
});

describe("edges", () => {
  it("merges parallel edges of one kind into one, summing the weight and keeping the worst verdict", () => {
    const g: KnowledgeGraph = {
      scope: { rootId: "r", packs: [], digest: "d" }, nodes: [node(0), node(1)],
      edges: [{ ...edge(0, 1), verdict: "skips" }, { ...edge(0, 1, "references", 2), verdict: "upward", cycle: true }, edge(0, 1, "calls")],
      findings: [], stats: { sources: 2, nodes: 2, edges: 3, stale: 0, truncated: false },
    };
    const out = boundGraph(g);
    expect(out.edges).toHaveLength(2);
    expect(out.edges.find((e) => e.kind === "references")).toMatchObject({ weight: 3, verdict: "upward", cycle: true });
  });

  it("capEdges keeps structural kinds before references, heaviest first, in original order", () => {
    const edges = [edge(0, 1, "references", 9), edge(1, 2, "calls", 1), edge(2, 3, "references", 1), edge(3, 4, "links", 1)];
    expect(capEdges(edges, 2).map((e) => e.kind)).toEqual(["calls", "links"]);
  });
});

describe("foldPartitionViolations", () => {
  it("regression: carries REAL findings, each one [from, to] pair with its own id, so [from, to] consumers read them unchanged", () => {
    const input = syntheticGraph().findings;
    const byId = new Map(input.map((f) => [f.id, f]));
    const out = foldPartitionViolations(input, 400);
    const pv = out.findings.filter((f) => f.kind === "partition-violation");
    expect(pv.every((f) => f.nodes.length === 2 && byId.get(f.id)?.nodes.join() === f.nodes.join())).toBe(true);
    expect(pv.reduce((n, f) => n + (Number(f.params.count) || 1), 0)).toBe(20_000);
    expect(out.carried).toBe(pv.length);
  });

  it("drops only the smallest groups past the cap, and counts what it dropped", () => {
    const out = foldPartitionViolations(syntheticGraph().findings, 5);
    expect(out.keptGroups).toBe(5);
    const carried = out.findings.filter((f) => f.kind === "partition-violation").reduce((n, f) => n + (Number(f.params.count) || 1), 0);
    expect(carried + out.droppedViolations).toBe(20_000);
  });

  it("is idempotent: a folded finding keeps its count when folded again", () => {
    const once = foldPartitionViolations(syntheticGraph().findings, 400);
    const twice = foldPartitionViolations(once.findings, 400);
    expect(twice.violations).toBe(once.violations);
    expect(twice.findings.length).toBe(once.findings.length);
  });
});
