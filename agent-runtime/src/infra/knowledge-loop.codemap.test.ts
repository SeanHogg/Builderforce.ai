import { describe, expect, it, vi } from "vitest";

const pushProjectFact = vi.fn(async (..._args: unknown[]) => true);
vi.mock("./project-facts-sync.js", () => ({
  pushProjectFact: (...a: unknown[]) => pushProjectFact(...a),
  recallSharedProjectFacts: async () => [],
}));

import { KnowledgeLoopService } from "./knowledge-loop.js";

/**
 * `commitCodeMap` — the ONE run-end map write, used by event-fed runs and by the
 * Claude Agent SDK relay run (which keeps its own record in a ticket workspace).
 */
describe("KnowledgeLoopService.commitCodeMap", () => {
  const map = { key: "codemap:api/src", content: "Code map for `api/src`" };

  it("writes the run's map, consolidated against the given root, to the shared store", () => {
    pushProjectFact.mockClear();
    const svc = new KnowledgeLoopService({ workspaceDir: "/w", apiKey: "k", baseUrl: "https://gw", agentNodeId: "5", projectId: 9 });
    const consolidate = vi.fn(() => map);
    svc.commitCodeMap({ consolidate }, "/w/.builderforce/tasks/3");
    expect(consolidate).toHaveBeenCalledWith({ root: "/w/.builderforce/tasks/3" });
    expect(pushProjectFact).toHaveBeenCalledWith(expect.objectContaining({ projectId: 9, agentHostId: 5 }), map.key, map.content);
  });

  it("writes nothing without project credentials or without a map", () => {
    pushProjectFact.mockClear();
    new KnowledgeLoopService({ workspaceDir: "/w" }).commitCodeMap({ consolidate: () => map }, "/w");
    new KnowledgeLoopService({ workspaceDir: "/w", apiKey: "k", agentNodeId: "5", projectId: 9 }).commitCodeMap({ consolidate: () => null }, "/w");
    expect(pushProjectFact).not.toHaveBeenCalled();
  });
});
