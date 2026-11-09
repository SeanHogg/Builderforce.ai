import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVIDENCE_POLICY,
  commitGate,
  outgoingGate,
  reviewGate,
  shellBypass,
  shellPublishHint,
  type EvidencePolicy,
  type OutgoingFile,
  type ReviewVerdict,
} from "./gates.js";
import { createEvidenceLedger, type CheckRecord } from "./ledger.js";

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

const POLICY: EvidencePolicy = {
  required: { ".ts": ["diagnostics", "typecheck", "test"], ".md": ["guard"] },
  newSourceNeedsTest: true,
  checkTimeoutMs: 120_000,
};

const file = (absPath: string, over: Partial<OutgoingFile> = {}): OutgoingFile => ({
  absPath,
  hash: "h1",
  isNew: false,
  deleted: false,
  ...over,
});

/** A .ts file with every required check recorded as passing. */
function passingLedger(absPath: string, hash = "h1") {
  const l = createEvidenceLedger();
  for (const kind of ["diagnostics", "typecheck", "test"] as const) {
    l.record(absPath, hash, rec({ kind, name: kind, exitCode: kind === "diagnostics" ? null : 0 }));
  }
  return l;
}

describe("outgoingGate / commitGate", () => {
  it("passes when every required check has a passing record for the file's hash", () => {
    const v = outgoingGate([file("packages/a/src/x.ts")], passingLedger("packages/a/src/x.ts"), POLICY);
    expect(v).toEqual({ ok: true, unavailable: [] });
  });

  it("commitGate is the same gate (one gate serves commit advisory and push refusal)", () => {
    const files = [file("packages/a/src/x.ts")];
    const ledger = passingLedger("packages/a/src/x.ts");
    expect(commitGate(files, ledger, POLICY)).toEqual(outgoingGate(files, ledger, POLICY));
  });

  it("refuses on a failing check and names the file, check and first findings", () => {
    const l = passingLedger("packages/a/src/inbound.ts");
    l.record(
      "packages/a/src/inbound.ts",
      "h1",
      rec({
        kind: "typecheck",
        name: "pnpm --filter a typecheck",
        outcome: "fail",
        exitCode: 2,
        findings: ["inbound.ts:52:9 error TS2345 (ts)", "inbound.ts:61:3 error TS7006 (ts)"],
      }),
    );
    const v = outgoingGate([file("packages/a/src/inbound.ts")], l, POLICY);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toContain("packages/a/src/inbound.ts");
      expect(v.reason).toContain("typecheck");
      expect(v.reason).toContain("inbound.ts:52:9 error TS2345");
      expect(v.reason).toContain("exit 2");
      expect(v.reason).toContain("push again");
    }
  });

  it("passes-but-reports when a check is unavailable (OD-3), never reported as verified", () => {
    const l = passingLedger("packages/a/src/x.ts");
    l.record("packages/a/src/x.ts", "h1", rec({ kind: "test", name: "vitest", outcome: "unavailable", exitCode: null }));
    const v = outgoingGate([file("packages/a/src/x.ts")], l, POLICY);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.unavailable.join(" ")).toContain("vitest");
      expect(v.unavailable.join(" ")).toContain("packages/a/src/x.ts");
    }
  });

  it("passes-but-reports when the verifier left no record at all for the file (OD-3)", () => {
    const l = createEvidenceLedger();
    l.record("packages/a/src/x.ts", "h1", rec({ kind: "typecheck" }));
    const v = outgoingGate([file("packages/a/src/x.ts")], l, POLICY);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.unavailable).toHaveLength(2); // diagnostics + test unrecorded
  });

  it("refuses on an error-severity diagnostics finding even when the record outcome is pass", () => {
    const l = passingLedger("packages/a/src/x.ts");
    l.record(
      "packages/a/src/x.ts",
      "h1",
      rec({ kind: "diagnostics", name: "lsp", outcome: "pass", exitCode: null, findings: ["x.ts:7:5 error TS2304 (ts)"] }),
    );
    const v = outgoingGate([file("packages/a/src/x.ts")], l, POLICY);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("x.ts:7:5 error TS2304");
  });

  it("a diagnostics warning is not an error and does not fail the gate", () => {
    const l = passingLedger("packages/a/src/x.ts");
    l.record(
      "packages/a/src/x.ts",
      "h1",
      rec({ kind: "diagnostics", name: "lsp", exitCode: null, findings: ["x.ts:7:5 warning TS6133 (ts)"] }),
    );
    expect(outgoingGate([file("packages/a/src/x.ts")], l, POLICY)).toEqual({ ok: true, unavailable: [] });
  });

  it("skips deleted paths — the owning package's typecheck covers what imported them", () => {
    const v = outgoingGate([file("packages/a/src/gone.ts", { deleted: true })], createEvidenceLedger(), POLICY);
    expect(v).toEqual({ ok: true, unavailable: [] });
  });

  it("refuses when the file's bytes changed after the evidence was recorded (hash mismatch)", () => {
    const l = passingLedger("packages/a/src/x.ts", "h1");
    // run_command / the human / a sub-agent rewrote the file before push: h2.
    const v = outgoingGate([file("packages/a/src/x.ts", { hash: "h2" })], l, POLICY);
    expect(v.ok).toBe(true); // no evidence for h2 → every check reports unavailable, never pass
    if (v.ok) expect(v.unavailable.length).toBe(3);
  });

  it("regression: a file changed by run_command is still checked at push", () => {
    // The model edited via a shell script instead of edit_file; the ledger holds no
    // evidence for the current bytes, so the push cannot present them as verified.
    const v = outgoingGate([file("packages/a/src/x.ts", { hash: "h-shell" })], createEvidenceLedger(), POLICY);
    expect(v.ok).toBe(true);
    if (v.ok) {
      const text = v.unavailable.join(" ");
      expect(text).toContain("no record");
      expect(text).not.toMatch(/verified/i);
    }
  });

  it("regression: tsc piped through grep is not evidence", () => {
    // A model's transcript line `npx tsc | grep error | head -20; echo DONE` never
    // reaches this module: no host code parses model output into CheckRecords, and
    // the pipe also hides tsc's real exit code behind head's. Even a forged record is
    // useless — the gate looks evidence up by the hash of the file's real bytes, and
    // the model does not control that hash. Here the ledger is EMPTY and the verdict
    // must not be a clean "verified" pass.
    const transcriptClaim = "npx tsc --noEmit | grep error | head -20; echo DONE";
    expect(transcriptClaim).toMatch(/\|\s*(grep|head)\b/);
    const v = outgoingGate([file("packages/a/src/x.ts")], createEvidenceLedger(), POLICY);
    expect(v.ok).toBe(true); // OD-3: pass-but-report, never a silent verified pass
    if (v.ok) expect(v.unavailable.length).toBeGreaterThan(0);
  });

  it("regression: new source without a test is refused (chat #214)", () => {
    const files = [file("packages/agent-runtime/extensions/a2a/src/inbound.ts", { isNew: true })];
    const v = outgoingGate(files, passingLedger("packages/agent-runtime/extensions/a2a/src/inbound.ts"), POLICY);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toContain("agent-runtime/extensions/a2a/src/inbound.ts");
      expect(v.reason).toContain("no test in this push");
      expect(v.reason).toContain("inbound.test.ts");
    }
  });

  it("a new x.test.ts in the same push satisfies the new-source test requirement", () => {
    const dir = "packages/agent-runtime/extensions/a2a/src/";
    const files = [file(dir + "inbound.ts", { isNew: true }), file(dir + "inbound.test.ts", { isNew: true })];
    const l = passingLedger(dir + "inbound.ts");
    for (const kind of ["diagnostics", "typecheck", "test"] as const) l.record(dir + "inbound.test.ts", "h1", rec({ kind, name: kind, exitCode: null }));
    expect(outgoingGate(files, l, POLICY)).toEqual({ ok: true, unavailable: [] });
  });

  it("an unrelated test file does not satisfy the requirement — the name must start with the stem", () => {
    const dir = "packages/agent-runtime/extensions/a2a/src/";
    const files = [file(dir + "inbound.ts", { isNew: true }), file(dir + "other.test.ts", { isNew: true })];
    const v = outgoingGate(files, passingLedger(dir + "inbound.ts"), POLICY);
    expect(v.ok).toBe(false);
  });

  it("extensions with no required policy pass without any records", () => {
    expect(outgoingGate([file("assets/logo.png")], createEvidenceLedger(), POLICY)).toEqual({ ok: true, unavailable: [] });
  });

  it("DEFAULT_EVIDENCE_POLICY requires diagnostics+typecheck+test for .ts/.tsx and wants new-source tests", () => {
    expect(DEFAULT_EVIDENCE_POLICY.required[".ts"]).toEqual(["diagnostics", "typecheck", "test"]);
    expect(DEFAULT_EVIDENCE_POLICY.required[".tsx"]).toEqual(["diagnostics", "typecheck", "test"]);
    expect(DEFAULT_EVIDENCE_POLICY.newSourceNeedsTest).toBe(true);
    expect(DEFAULT_EVIDENCE_POLICY.checkTimeoutMs).toBeGreaterThan(0);
  });
});

describe("reviewGate (OD-1)", () => {
  const review = (over: Partial<ReviewVerdict> = {}): ReviewVerdict => ({
    reviewerModel: "opus-reviewer",
    verdict: "approved",
    diffHash: "d1",
    findings: [],
    ...over,
  });
  const ok = { ok: true, unavailable: [] };

  it("regression: reviewer on an author model is refused", () => {
    const v = reviewGate(review({ reviewerModel: "sonnet-author" }), ["sonnet-author", "gpt-4"], "d1");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("sonnet-author");
  });

  it("refuses when there is no review", () => {
    const v = reviewGate(undefined, ["sonnet-author"], "d1");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("no independent review");
  });

  it("refuses when the diff changed after the review", () => {
    const v = reviewGate(review(), [], "d2");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("diff changed");
  });

  it("returns the reviewer's findings as the reason on changes_requested", () => {
    const v = reviewGate(review({ verdict: "changes_requested", findings: ["inbound.ts:52 missing params"] }), [], "d1");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("inbound.ts:52 missing params");
  });

  it("passes on an approved, current, different-model review", () => {
    expect(reviewGate(review(), ["sonnet-author"], "d1")).toEqual(ok);
  });
});

describe("shellPublishHint / shellBypass", () => {
  it("advises on a shell git commit or push (never a refusal — the outgoing gate reads the real commits)", () => {
    const hint = shellPublishHint("git -C Builderforce.ai commit -am wip && git push");
    expect(hint).toBeTruthy();
    expect(hint).toContain("git_push");
    expect(shellPublishHint("git -C Builderforce.ai status")).toBeNull();
    expect(shellPublishHint("pnpm test")).toBeNull();
  });

  it("shellBypass is the same advisory", () => {
    expect(shellBypass("git push")).toEqual(shellPublishHint("git push"));
  });
});
