import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore } from "@builderforce/local-first";
import type { RunDelta } from "@builderforce/run-delta";
import { readRunDeltaHistory } from "./runDeltaHistory";
import { storeRunDelta } from "./runDeltaRecords";

const ROOT = "/work/repo";

function delta(runId: string, score: number, headline: RunDelta["headline"] = "same"): RunDelta {
  return {
    runId, headline, digest: `d-${runId}`, blocking: headline === "worse" ? ["guard-removed"] : [],
    summary: { verdict: headline, clauses: [], unchanged: [], notMeasured: [] },
    blastRadius: { score, band: score > 5 ? "high" : "low", formula: "v1", reasons: [] },
    dimensions: [{
      id: "security", verdict: headline, reasons: [], metrics: [], measuredBy: [],
      findings: [
        { lineage: "introduced" }, { lineage: "resolved" }, { lineage: "persisting" },
      ],
    }],
  } as unknown as RunDelta;
}

async function store(runs: Array<{ runId: string; at: string; score: number; headline?: RunDelta["headline"]; repo?: string }>) {
  const s = createMemoryLocalFirstStore();
  for (const r of runs) {
    const repo = r.repo ?? ROOT;
    await storeRunDelta(s, { deviceId: "dev", at: r.at }, {
      value: { runId: r.runId, repository: `local:${repo}`, changeSetId: `changeset:${r.runId}:k`, chatId: 1, mode: "autonomous", delta: delta(r.runId, r.score, r.headline), computedMs: 5 },
      local: { kind: "local", runId: r.runId, chatId: 1, root: repo, repo },
    });
  }
  return s;
}

describe("run delta history (PRD 41 §C11.3)", () => {
  it("lists a repository's stored deltas as summaries, newest first, limited", async () => {
    // The synced identity of a local root is `local:<hash>`: write the rows under the same key the reader computes.
    const { syncedRepository } = await import("./runDeltaRecords");
    const key = syncedRepository(ROOT);
    const s = createMemoryLocalFirstStore();
    for (const [runId, at, score] of [["r1", "2026-11-01T00:00:00Z", 1], ["r3", "2026-11-03T00:00:00Z", 9], ["r2", "2026-11-02T00:00:00Z", 3]] as const) {
      await storeRunDelta(s, { deviceId: "dev", at }, {
        value: { runId, repository: key, changeSetId: `changeset:${runId}:k`, chatId: 1, mode: "autonomous", delta: delta(runId, score, runId === "r3" ? "worse" : "same"), computedMs: 5 },
        local: { kind: "local", runId, chatId: 1, root: ROOT, repo: ROOT },
      });
    }
    const rows = await readRunDeltaHistory(s, { repo: ROOT });
    expect(rows.map((r) => r.runId)).toEqual(["r3", "r2", "r1"]);
    expect(rows[0]).toMatchObject({
      repoKey: key, surface: "vscode", mode: "autonomous", computedAt: "2026-11-03T00:00:00Z", headline: "worse",
      verdicts: { security: "worse" }, counts: { introduced: 1, resolved: 1 }, blastRadius: { score: 9, band: "high" }, blocking: ["guard-removed"],
    });
    expect((await readRunDeltaHistory(s, { repo: ROOT, limit: 2 })).map((r) => r.runId)).toEqual(["r3", "r2"]);
  });

  it("answers nothing for another repository or an empty name", async () => {
    const s = await store([{ runId: "r1", at: "2026-11-01T00:00:00Z", score: 1 }]);
    expect(await readRunDeltaHistory(s, { repo: "/elsewhere" })).toEqual([]);
    expect(await readRunDeltaHistory(s, { repo: "" })).toEqual([]);
  });
});
