import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ semanticCalls: [] as Array<{ adaptive?: boolean } | undefined>, leverOn: false }));

vi.mock("./on-prem-semantic.js", () => ({
  resolveOnPremSemantic: vi.fn(async (_root: string, opts?: { adaptive?: boolean }) => {
    state.semanticCalls.push(opts);
    return { repoMap: async () => "" };
  }),
}));
vi.mock("./local-research/on-prem-research-model.js", () => ({
  resolveOnPremResearch: vi.fn(async () => undefined),
}));
vi.mock("../infra/cost-levers.js", () => ({
  onDeviceCostLeverOn: vi.fn(() => state.leverOn),
}));

import { resolveOnPremLocalBackings } from "./on-prem-local-backings.js";

// Every caller (attempt, compaction, system-prompt report) gets the SAME C4 decision
// without passing it — the compaction tool list cannot drift from the attempt's.
describe("resolveOnPremLocalBackings — C4 decided in one place", () => {
  beforeEach(() => {
    state.semanticCalls.length = 0;
  });

  it("applies the on-device lever when the caller passes nothing", async () => {
    state.leverOn = true;
    await resolveOnPremLocalBackings({ workspaceRoot: "/w" });
    state.leverOn = false;
    await resolveOnPremLocalBackings({ workspaceRoot: "/w" });
    expect(state.semanticCalls).toEqual([{ adaptive: true }, { adaptive: false }]);
  });

  it("honours an explicit override", async () => {
    state.leverOn = true;
    await resolveOnPremLocalBackings({ workspaceRoot: "/w", adaptive: false });
    expect(state.semanticCalls).toEqual([{ adaptive: false }]);
  });
});
