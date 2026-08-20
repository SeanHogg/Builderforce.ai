import { rankModelsForAction } from "@builderforce/learned-routing";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { classifyRunAction, MIN_CONFIDENCE } from "./action-classifier.js";
import { alignStatsToCandidates, candidateKey } from "./candidate-keys.js";
import { computeLocalBias, MAX_LOCAL_BIAS, type LocalOutcome } from "./local-bias.js";
import {
  clearLocalOutcomes,
  readLocalOutcomes,
  recordLocalOutcome,
  HISTORY_CAPACITY,
} from "./local-history.js";
import { buildRunOutcomeReport, clientRunIdFor } from "./outcome-reporter.js";
import { toRankStat, toScopeRanking } from "./routing-table-client.js";
import { learnedSeedingOn, SEED_FLAG_ENV } from "./settings.js";

describe("classifyRunAction", () => {
  it("labels obvious work with the shared taxonomy's bucket", () => {
    expect(
      classifyRunAction("Fix the bug where the parser crashes on empty input").actionType,
    ).toBe("bugfix");
    expect(classifyRunAction("Add unit tests for the auth service with vitest").actionType).toBe(
      "tests",
    );
    expect(
      classifyRunAction("Write a SQL migration: create table invoices with a foreign key")
        .actionType,
    ).toBe("sql");
    expect(classifyRunAction("Update the README and the changelog documentation").actionType).toBe(
      "docs",
    );
    expect(
      classifyRunAction("Refactor the handler: extract a helper and deduplicate").actionType,
    ).toBe("refactor");
    expect(classifyRunAction("Backfill the data migration for archived rows").actionType).toBe(
      "data_migration",
    );
  });

  it("falls back to `other` rather than guessing when there is no signal", () => {
    expect(classifyRunAction("hello").actionType).toBe("other");
    expect(classifyRunAction("").actionType).toBe("other");
    expect(classifyRunAction(undefined)).toEqual({ actionType: "other", confidence: 0 });
  });

  it("a mislabel is worse than the fallback: split evidence resolves to `other`", () => {
    // Deliberately mixes three vocabularies so no bucket can clear the floor.
    const verdict = classifyRunAction(
      "Refactor the SQL query, document it in the README, and deploy via the CI pipeline to kubernetes",
    );
    expect(verdict.confidence).toBeLessThan(MIN_CONFIDENCE);
    expect(verdict.actionType).toBe("other");
  });

  it("pasted context is discounted, so a repository's vocabulary cannot decide the label", () => {
    // The shape of a real agent prompt: an instruction, a blank line, then a wall of
    // pasted files whose words describe the CODEBASE and not the work.
    const noise = "database schema sql query postgres\n".repeat(400);
    expect(
      classifyRunAction(`Fix the crashing bug in the parser.

${noise}`).actionType,
    ).toBe("bugfix");
  });

  it("is deterministic", () => {
    const prompt = "Add integration tests for the deploy pipeline";
    expect(classifyRunAction(prompt)).toEqual(classifyRunAction(prompt));
  });
});

describe("computeLocalBias", () => {
  const now = 1_700_000_000_000;
  const outcome = (model: string, succeeded: boolean, over = 0): LocalOutcome => ({
    model,
    actionType: "bugfix",
    succeeded,
    at: now - over,
  });

  it("is empty with no history — absent means no opinion", () => {
    expect(computeLocalBias([], { now, actionType: "bugfix" })).toEqual({});
  });

  it("rewards a locally-successful model and penalises a locally-failing one", () => {
    const bias = computeLocalBias(
      [
        ...Array.from({ length: 6 }, () => outcome("a/good", true)),
        ...Array.from({ length: 6 }, () => outcome("b/bad", false)),
      ],
      { now, actionType: "bugfix" },
    );
    expect(bias["a/good"]).toBeGreaterThan(0);
    expect(bias["b/bad"]).toBeLessThan(0);
  });

  it("can NEVER dominate the fleet stats — every nudge is inside the bound", () => {
    const history = Array.from({ length: 500 }, () => outcome("a/good", true));
    const bias = computeLocalBias(history, { now, actionType: "bugfix" });
    expect(Math.abs(bias["a/good"])).toBeLessThanOrEqual(MAX_LOCAL_BIAS);
  });

  it("one lucky run is worth almost nothing (evidence-scaled + smoothed)", () => {
    const thin = computeLocalBias([outcome("a/good", true)], { now, actionType: "bugfix" });
    const thick = computeLocalBias(
      Array.from({ length: 20 }, () => outcome("a/good", true)),
      { now, actionType: "bugfix" },
    );
    expect(thin["a/good"]).toBeLessThan(thick["a/good"]);
    expect(thin["a/good"]).toBeLessThan(MAX_LOCAL_BIAS / 3);
  });

  it("ignores another action type and anything outside the window", () => {
    const history: LocalOutcome[] = [
      { model: "a/good", actionType: "docs", succeeded: true, at: now },
      outcome("a/good", true, 60 * 24 * 60 * 60 * 1000),
    ];
    expect(computeLocalBias(history, { now, actionType: "bugfix" })).toEqual({});
  });

  it("counts a rate-limited run as a local failure without calling the model bad", () => {
    const history = Array.from({ length: 6 }, () => ({
      model: "a/throttled",
      actionType: "bugfix",
      succeeded: true,
      rateLimited: true,
      at: now,
    }));
    expect(computeLocalBias(history, { now, actionType: "bugfix" })["a/throttled"]).toBeLessThan(0);
  });

  it("nudges ordering only among models the fleet already ranks close", () => {
    const stats = [
      { model: "a/one", n: 20, avgScore: 0.6, avgCostMc: 0 },
      { model: "b/two", n: 20, avgScore: 0.61, avgCostMc: 0 },
    ];
    const pool = ["a/one", "b/two"];
    expect(rankModelsForAction(pool, stats)[0]).toBe("b/two");
    const bias = computeLocalBias(
      Array.from({ length: 20 }, () => outcome("a/one", true)),
      { now, actionType: "bugfix" },
    );
    expect(rankModelsForAction(pool, stats, { bias })[0]).toBe("a/one");
    // …but a model the fleet rates far higher stays in front.
    const wide = [
      { model: "a/one", n: 20, avgScore: 0.2, avgCostMc: 0 },
      { model: "b/two", n: 20, avgScore: 0.9, avgCostMc: 0 },
    ];
    expect(rankModelsForAction(pool, wide, { bias })[0]).toBe("b/two");
  });
});

describe("local history ring", () => {
  beforeEach(clearLocalOutcomes);
  afterEach(clearLocalOutcomes);

  it("records and reads back, and refuses an outcome with no model", () => {
    recordLocalOutcome({ model: "a/one", actionType: "docs", succeeded: true, at: 1 });
    recordLocalOutcome({ model: "", actionType: "docs", succeeded: true, at: 2 });
    expect(readLocalOutcomes()).toHaveLength(1);
  });

  it("stays bounded", () => {
    for (let i = 0; i < HISTORY_CAPACITY + 25; i++) {
      recordLocalOutcome({ model: `m/${i}`, actionType: "docs", succeeded: true, at: i });
    }
    const all = readLocalOutcomes();
    expect(all).toHaveLength(HISTORY_CAPACITY);
    expect(all[all.length - 1].model).toBe(`m/${HISTORY_CAPACITY + 24}`);
  });
});

describe("alignStatsToCandidates", () => {
  const candidates = [
    { provider: "anthropic", model: "claude-opus-4" },
    { provider: "openai", model: "gpt-5.3-codex" },
  ];

  it("matches an exact provider/model key", () => {
    const aligned = alignStatsToCandidates(candidates, [
      { model: "anthropic/claude-opus-4", n: 10, avgScore: 0.8, avgCostMc: 5 },
    ]);
    expect(aligned).toEqual([
      { model: "anthropic/claude-opus-4", n: 10, avgScore: 0.8, avgCostMc: 5 },
    ]);
  });

  it("matches a fleet id whose vendor prefix differs but whose model id is the same", () => {
    const aligned = alignStatsToCandidates(candidates, [
      { model: "openrouter/gpt-5.3-codex", n: 9, avgScore: 0.7, avgCostMc: 1 },
    ]);
    expect(aligned.map((s) => s.model)).toEqual(["openai/gpt-5.3-codex"]);
  });

  it("drops an unknown model and an AMBIGUOUS one rather than crediting a coin flip", () => {
    expect(
      alignStatsToCandidates(candidates, [
        { model: "meta/llama-4", n: 9, avgScore: 1, avgCostMc: 0 },
      ]),
    ).toEqual([]);
    const twoProviders = [
      { provider: "openai", model: "gpt-5.3-codex" },
      { provider: "azure", model: "gpt-5.3-codex" },
    ];
    expect(
      alignStatsToCandidates(twoProviders, [
        { model: "gpt-5.3-codex", n: 9, avgScore: 1, avgCostMc: 0 },
      ]),
    ).toEqual([]);
  });

  it("candidateKey is the ranker's key space", () => {
    expect(candidateKey({ provider: "ollama", model: "gemma3:4b" })).toBe("ollama/gemma3:4b");
  });
});

describe("routing-table client shaping", () => {
  it("maps an analytics row onto every field the ranker reads", () => {
    expect(
      toRankStat({
        model: "anthropic/claude-opus-4",
        samples: 12,
        avgScore: 0.82,
        avgCostMillicents: 4200,
        ratedUp: 3,
        ratedDown: 1,
        rateLimitRate: 0.25,
      }),
    ).toEqual({
      model: "anthropic/claude-opus-4",
      n: 12,
      avgScore: 0.82,
      avgCostMc: 4200,
      ratedUp: 3,
      ratedDown: 1,
      rateLimitRate: 0.25,
    });
  });

  it("tolerates a row with no model and a body with no buckets", () => {
    expect(toRankStat({ samples: 3 })).toBeNull();
    expect(toScopeRanking(null)).toEqual({});
    expect(toScopeRanking({ byAction: "nope" })).toEqual({});
  });

  it("shapes a whole body into a per-action ranking", () => {
    const ranking = toScopeRanking({
      byAction: [
        { actionType: "bugfix", models: [{ model: "a/one", samples: 5, avgScore: 0.5 }] },
        { actionType: "docs", models: [] },
      ],
    });
    expect(Object.keys(ranking)).toEqual(["bugfix"]);
    expect(ranking.bugfix?.[0]?.model).toBe("a/one");
  });
});

describe("run-outcome payload", () => {
  it("namespaces the run id into the api's global idempotency key space", () => {
    expect(clientRunIdFor("abc-123")).toBe("onprem:abc-123");
    expect(clientRunIdFor("x".repeat(300)).length).toBe(128);
  });

  it("sends exactly the fields the route accepts, and no false gate results", () => {
    const body = buildRunOutcomeReport({
      runId: "run-9",
      model: "anthropic/claude-opus-4",
      actionType: "bugfix",
      terminalStatus: "completed",
      steps: 7.8,
      degraded: false,
      rateLimited: false,
    });
    expect(body).toEqual({
      clientRunId: "onprem:run-9",
      source: "onprem",
      model: "anthropic/claude-opus-4",
      terminalStatus: "completed",
      actionType: "bugfix",
      steps: 7,
      degraded: false,
      rateLimited: false,
    });
    // An embedded run has no PR, no CI and no approval: reporting them as `false`
    // would score it as having FAILED gates that never applied.
    expect(body).not.toHaveProperty("merged");
    expect(body).not.toHaveProperty("ciGreen");
    expect(body).not.toHaveProperty("approved");
  });

  it("carries the rate-limit availability signal a failed run can report", () => {
    const body = buildRunOutcomeReport({
      runId: "run-10",
      model: "a/one",
      actionType: "other",
      terminalStatus: "failed",
      rateLimited: true,
    });
    expect(body.terminalStatus).toBe("failed");
    expect(body.rateLimited).toBe(true);
  });
});

describe("seeding flag", () => {
  const prev = process.env[SEED_FLAG_ENV];
  afterEach(() => {
    if (prev === undefined) {
      delete process.env[SEED_FLAG_ENV];
    } else {
      process.env[SEED_FLAG_ENV] = prev;
    }
  });

  it("defaults OFF — an operator's explicit model pin is not silently reordered", () => {
    delete process.env[SEED_FLAG_ENV];
    expect(learnedSeedingOn()).toBe(false);
  });

  it("opts in on the usual truthy spellings", () => {
    for (const v of ["1", "true", "on", "yes", "TRUE"]) {
      process.env[SEED_FLAG_ENV] = v;
      expect(learnedSeedingOn()).toBe(true);
    }
    process.env[SEED_FLAG_ENV] = "0";
    expect(learnedSeedingOn()).toBe(false);
  });
});
