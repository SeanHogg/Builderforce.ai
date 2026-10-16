import { describe, expect, it } from "vitest";
import { rankCandidates } from "./candidate-ranking.js";
import { catalogViewFromEntries } from "./model-catalog-view.js";

const view = catalogViewFromEntries([
  { provider: "builderforcellm", id: "auto", cost: { input: 0, output: 0 } },
  { provider: "together", id: "glm", cost: { input: 0.45, output: 2 } },
  { provider: "anthropic", id: "claude-sonnet-5-5", cost: { input: 3, output: 15 } },
  { provider: "anthropic", id: "claude-opus-5-5", cost: { input: 5, output: 25 } },
]);

// The operator's chain: free pool first, flagship last.
const chain = [
  { provider: "builderforcellm", model: "auto" },
  { provider: "together", model: "glm" },
  { provider: "anthropic", model: "claude-sonnet-5-5" },
  { provider: "anthropic", model: "claude-opus-5-5" },
];
const keys = (list: typeof chain) => list.map((c) => `${c.provider}/${c.model}`);

describe("rankCandidates — the on-prem caller of the shared router", () => {
  it("code leads with the strongest tier", () => {
    expect(keys(rankCandidates(chain, { routing: { role: "code", view } }))[0]).toBe(
      "anthropic/claude-opus-5-5",
    );
  });

  it("utility and verify lead with the cheapest", () => {
    expect(keys(rankCandidates([...chain].reverse(), { routing: { role: "utility", view } }))[0]).toBe(
      "builderforcellm/auto",
    );
    expect(keys(rankCandidates([...chain].reverse(), { routing: { role: "verify", view } }))[0]).toBe(
      "builderforcellm/auto",
    );
  });

  it("plan keeps the operator's order exactly", () => {
    expect(keys(rankCandidates(chain, { routing: { role: "plan", view } }))).toEqual(keys(chain));
  });

  it("keeps the operator's order when the catalog cannot tier every candidate", () => {
    const withPin = [...chain, { provider: "openai", model: "unpriced-pin" }];
    expect(keys(rankCandidates(withPin, { routing: { role: "code", view } }))).toEqual(keys(withPin));
  });

  it("with no role and no evidence, changes nothing", () => {
    expect(keys(rankCandidates(chain))).toEqual(keys(chain));
  });

  it("with no role, learned evidence alone reorders (the opt-in seed)", () => {
    const stats = [{ model: "anthropic/claude-sonnet-5-5", n: 50, avgScore: 0.95, avgCostMc: 10 }];
    expect(keys(rankCandidates(chain, { stats }))[0]).toBe("anthropic/claude-sonnet-5-5");
  });

  it("a balanced role ignores learned evidence — the operator's order stands", () => {
    const stats = [{ model: "anthropic/claude-sonnet-5-5", n: 50, avgScore: 0.95, avgCostMc: 10 }];
    expect(keys(rankCandidates(chain, { routing: { role: "plan", view }, stats }))).toEqual(keys(chain));
  });

  it("is always a permutation of the input", () => {
    for (const role of ["code", "plan", "verify", "explore", "chat", "utility"] as const) {
      const ranked = keys(rankCandidates(chain, { routing: { role, view } }));
      expect([...ranked].sort()).toEqual([...keys(chain)].sort());
    }
  });
});
