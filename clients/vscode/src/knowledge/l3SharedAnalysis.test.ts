import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ key: "k1" as string | null, runs: 0 }));
vi.mock("../localCapabilities", () => ({ buildLocalCapabilityProvider: () => ({}) }));
vi.mock("@builderforce/repo-map", () => ({ repoMapPort: {} }));
vi.mock("./l3Worker", () => ({ runL3InWorker: vi.fn(async () => { h.runs += 1; return { extracted: [], snapshot: { tools: [{ status: "complete" }] }, edges: 1 }; }) }));
vi.mock("@builderforce/agent-tools/knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@builderforce/agent-tools/knowledge")>()),
  workspaceAnalysisKey: async () => h.key,
}));

import { forgetSharedAnalyses, sharedAnalysis } from "./l3SharedAnalysis";

beforeEach(() => { forgetSharedAnalyses(); h.runs = 0; h.key = "k1"; });

describe("sharedAnalysis — ONE host-side cache in front of the worker", () => {
  // regression: every job spawned a fresh worker, so the per-sha cache never hit and each review/L3/prefetch rebuilt the whole graph.
  it("regression: the same tree is analysed ONCE for every caller (review, L3, code actions); a changed tree runs again", async () => {
    const job = { folderPath: "/ws", rootId: "r" };
    await Promise.all([sharedAnalysis(job), sharedAnalysis(job)]);
    await sharedAnalysis({ ...job, l3RootPath: "/ws" });
    expect(h.runs).toBe(1);
    h.key = "k2";
    await sharedAnalysis(job);
    expect(h.runs).toBe(2);
  });

  it("a tree git cannot identify is never kept", async () => {
    h.key = null;
    await sharedAnalysis({ folderPath: "/ws", rootId: "r" });
    await sharedAnalysis({ folderPath: "/ws", rootId: "r" });
    expect(h.runs).toBe(2);
  });
});
