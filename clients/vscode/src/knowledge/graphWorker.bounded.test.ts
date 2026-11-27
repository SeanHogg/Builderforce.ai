/**
 * regression: AE-G067 — a hired.video-sized load (123,843 edges, 24,768 findings, 2,763 kept nodes) stalled the extension
 * host's loop for 8 s. The bound (`graphBudget.ts`) belongs to the WORKER: the host receives only the bounded graph (never the
 * 123k edges to clone), never runs `boundGraph` itself, and its own steps (`send`, `assemble`) are named phases of the trace.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./folderKnowledge", () => ({ beforeKnowledgeShutdown: () => () => undefined, folderKnowledge: () => { throw new Error("no in-thread build here"); } }));
vi.mock("./graphBudget", async (importOriginal) => {
  const real = await importOriginal<typeof import("./graphBudget")>();
  return { ...real, boundGraph: vi.fn(real.boundGraph) };
});

import type { KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";
import { postBounded, type TransferPart } from "../workers/boundedTransfer";
import { boundGraph, boundsOf, MAX_GRAPH_EDGES } from "./graphBudget";
import { GRAPH_RESULT_ARRAYS, type GraphWorkerMessage, type GraphWorkerReply } from "./graphBuildProtocol";
import { buildOffThread, useGraphWorkerSeams, type GraphWorkerHandle } from "./graphWorker";
import { createLoadTrace } from "./knowledgeLoadTrace";

const NODES = 2763, EDGES = 123_843, FINDINGS = 24_768;

/** The graph the worker's build produces before the bound: a repository's worth of `references` edges and partition violations. */
function syntheticGraph(): KnowledgeGraph {
  const ref = (i: number): string => `src:root::area${i % 40}/dir${i % 7}/file${i}.ts`;
  const nodes = Array.from({ length: NODES }, (_, i) => ({ ref: ref(i), kind: "file", title: `file${i}` }));
  const edges = Array.from({ length: EDGES }, (_, i) => ({ from: ref(i % NODES), to: ref((i * 7 + 1) % NODES), kind: i % 25 === 0 ? "calls" : "references", weight: 1 + (i % 5) }));
  const findings = Array.from({ length: FINDINGS }, (_, i) => ({
    id: `f${i}`, kind: "partition-violation", severity: "warn", nodes: [ref(i % NODES), ref((i * 3 + 2) % NODES)],
    params: { verdict: "skips", from: `layer${i % 3}`, to: `layer${(i + 1) % 3}` },
  }));
  return { scope: { rootId: "root", packs: [], digest: "d" }, nodes, edges, findings, stats: { sources: 6315, nodes: NODES, edges: EDGES, stale: 0, truncated: true } } as unknown as KnowledgeGraph;
}

class FakeWorker implements GraphWorkerHandle {
  readonly sent: GraphWorkerMessage[] = [];
  private readonly listeners: Array<(value: unknown) => void> = [];
  postMessage(message: unknown): void { this.sent.push(message as GraphWorkerMessage); }
  on(event: "message" | "error" | "exit", listener: (value: any) => void): unknown { if (event === "message") this.listeners.push(listener); return this; }
  terminate(): Promise<number> { return Promise.resolve(1); }
  reply(reply: GraphWorkerReply): void { for (const l of this.listeners) l(reply); }
}

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; vi.mocked(boundGraph).mockClear(); });

describe("a large view load: the bound is the worker's", () => {
  it("the host receives at most the bounded edges and never bounds the graph itself", async () => {
    const worker = new FakeWorker();
    restore = useGraphWorkerSeams({ file: "fake-worker.js", spawn: () => worker });
    const lines: string[] = [];
    const trace = createLoadTrace({ log: (l) => lines.push(l), lagSampler: () => ({ enable: () => true, disable: () => true, max: 0, mean: 0, percentile: () => 0 }) });

    const answer = trace.run("load", "root", async (traced) => buildOffThread({ kind: "stored", folderPath: "/ws", rootId: "root", view: true }, undefined, traced.timer));
    await new Promise<void>((resolve) => setImmediate(resolve));

    // The worker's side: bound, then ship as bounded parts (what `graphWorkerEntry.ts` does).
    const built = syntheticGraph();
    const bounded = boundGraph(built);
    vi.mocked(boundGraph).mockClear(); // only calls made from here on are the HOST's
    const parts: TransferPart[] = [];
    const head = postBounded((p) => parts.push(p), bounded, GRAPH_RESULT_ARRAYS);
    const request = worker.sent.find((m): m is Extract<GraphWorkerMessage, { type: "build" }> => m.type === "build")!;
    expect(request.request).toMatchObject({ kind: "stored", view: true });

    const crossed = parts.filter((p) => p.key === "edges").reduce((n, p) => n + p.items.length, 0);
    expect(crossed).toBeLessThanOrEqual(MAX_GRAPH_EDGES);
    expect(crossed).toBeLessThan(EDGES / 5);
    for (const p of parts) worker.reply(p);
    worker.reply({ type: "done", id: request.id, result: head });

    const graph = (await answer)!;
    expect(graph.edges.length).toBe(crossed);
    expect(graph.edges.length).toBeLessThanOrEqual(MAX_GRAPH_EDGES);
    expect(graph.findings.length).toBeLessThan(FINDINGS / 10);
    expect(boundsOf(graph)?.edges.total).toBe(EDGES);
    // The host never ran the bound.
    expect(vi.mocked(boundGraph)).not.toHaveBeenCalled();
    // Its own steps are named in the load's trace line.
    expect(lines[0]).toMatch(/send=\d+ms/);
    expect(lines[0]).toMatch(/assemble=\d+ms/);
  }, 60_000);
});
