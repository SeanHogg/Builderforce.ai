import { describe, expect, it } from "vitest";
import { MAX_CHECK_FINDINGS, createEvidenceLedger, normalizeEvidencePath } from "./ledger.js";
import type { CheckRecord } from "./ledger.js";

let tick = 0;
const rec = (over: Partial<CheckRecord> = {}): CheckRecord => ({
  kind: "typecheck",
  name: "tsc",
  outcome: "pass",
  exitCode: 0,
  findings: [],
  at: ++tick,
  ...over,
});

describe("normalizeEvidencePath", () => {
  it("collapses backslashes and duplicate slashes so one helper keys every path", () => {
    expect(normalizeEvidencePath("C:\\code\\agentic//packages\\run-guards\\src\\a.ts")).toBe(
      "C:/code/agentic/packages/run-guards/src/a.ts",
    );
  });
});

describe("createEvidenceLedger", () => {
  it("records and returns checks for exactly the recorded hash", () => {
    const l = createEvidenceLedger();
    l.record("packages/a/src/x.ts", "h1", rec());
    expect(l.for("packages/a/src/x.ts", "h1")).toHaveLength(1);
    expect(l.current("packages/a/src/x.ts")).toEqual({
      path: "packages/a/src/x.ts",
      contentHash: "h1",
      checks: [expect.objectContaining({ kind: "typecheck" })],
    });
  });

  it("finds evidence through the normalisation helper (abs vs repo-relative)", () => {
    const l = createEvidenceLedger();
    l.record("C:\\code\\agentic\\packages\\a\\src\\x.ts", "h1", rec());
    expect(l.for("C:/code/agentic/packages/a/src/x.ts", "h1")).toHaveLength(1);
  });

  it("regression: stale check for old hash is dropped", () => {
    // The file is at h1 when the host starts the typecheck; the run rewrites the file
    // (h2) BEFORE the check finishes. The late record for h1 must not bless h2 — the
    // gate looks evidence up by the bytes on disk, and those are h2 now.
    const l = createEvidenceLedger();
    l.record("src/x.ts", "h1", rec({ kind: "typecheck", name: "tsc" }));
    l.noteWrite("src/x.ts");
    l.record("src/x.ts", "h2", rec({ kind: "test", name: "vitest" }));
    // A stale h1 record arriving after the h2 write is dropped.
    l.record("src/x.ts", "h1", rec({ kind: "diagnostics", name: "lsp" }));
    expect(l.for("src/x.ts", "h2").map((c) => c.kind)).toEqual(["test"]);
    expect(l.for("src/x.ts", "h1")).toEqual([]);
    expect(l.current("src/x.ts")?.contentHash).toBe("h2");
  });

  it("noteWrite drops evidence for older hashes of the path", () => {
    const l = createEvidenceLedger();
    l.record("src/x.ts", "h1", rec());
    l.noteWrite("src/x.ts");
    expect(l.for("src/x.ts", "h1")).toEqual([]);
    expect(l.current("src/x.ts")).toBeNull();
    expect(l.snapshot()).toEqual([]);
  });

  it("caps findings at 20 lines", () => {
    const l = createEvidenceLedger();
    const findings = Array.from({ length: 40 }, (_, i) => `x.ts:${i + 1}:1 error TS1`);
    l.record("src/x.ts", "h1", rec({ findings }));
    expect(l.for("src/x.ts", "h1")[0]?.findings).toHaveLength(MAX_CHECK_FINDINGS);
    expect(MAX_CHECK_FINDINGS).toBe(20);
  });

  it("snapshot/resume round-trips so a host persisting between steps keeps evidence", () => {
    const l = createEvidenceLedger();
    l.record("src/x.ts", "h1", rec({ name: "vitest" }));
    l.record("src/y.ts", "h9", rec({ name: "lsp", kind: "diagnostics", exitCode: null }));
    const resumed = createEvidenceLedger(JSON.parse(JSON.stringify(l.snapshot())));
    expect(resumed.for("src/x.ts", "h1")).toHaveLength(1);
    expect(resumed.current("src/y.ts")?.checks[0]?.name).toBe("lsp");
  });

  it("returns no evidence for an unknown path or hash", () => {
    const l = createEvidenceLedger();
    l.record("src/x.ts", "h1", rec());
    expect(l.for("src/other.ts", "h1")).toEqual([]);
    expect(l.for("src/x.ts", "h-other")).toEqual([]);
    expect(l.current("src/other.ts")).toBeNull();
  });

  it("stays clock-free: at is supplied by the caller and echoed back", () => {
    const l = createEvidenceLedger();
    l.record("src/x.ts", "h1", rec({ at: 1_700_000_000_000 }));
    expect(l.for("src/x.ts", "h1")[0]?.at).toBe(1_700_000_000_000);
  });
});
