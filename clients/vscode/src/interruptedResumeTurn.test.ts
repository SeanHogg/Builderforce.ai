import { describe, expect, it } from "vitest";
import { openOnlyResumeTurn, RESUME_TURN_DEFAULTS, type ResumeLabel } from "./interruptedResumeTurn";

/** The English fallback, exactly what the webview's `makeT` resolves when no override is set. */
const t: ResumeLabel = (key, fallback) => fallback;

describe("openOnlyResumeTurn", () => {
  it("scopes the turn to this chat's linked tickets and progress", () => {
    const turn = openOnlyResumeTurn(t, { doneCount: 3, openCount: 2, progressPct: 60 });
    expect(turn).toContain(RESUME_TURN_DEFAULTS["ir.openOnlyContinue"]);
    expect(turn).toContain("Linked tickets: 3 done, 2 open (60% complete).");
    expect(turn).toContain(RESUME_TURN_DEFAULTS["ir.continueScope"]);
  });

  it("fills an unknown percent with a placeholder rather than NaN", () => {
    expect(openOnlyResumeTurn(t, { doneCount: 0, openCount: 1, progressPct: null })).toContain("(?% complete).");
    expect(openOnlyResumeTurn(t, { doneCount: 0, openCount: 1, progressPct: Number.NaN })).toContain("(?% complete).");
  });

  it("rounds a fractional percent", () => {
    expect(openOnlyResumeTurn(t, { doneCount: 1, openCount: 2, progressPct: 33.6 })).toContain("(34% complete).");
  });
});
