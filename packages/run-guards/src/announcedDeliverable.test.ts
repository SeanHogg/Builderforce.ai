import { describe, expect, it } from "vitest";

import { announcesDeliverable } from "./readinessClaim.js";

describe("announcesDeliverable", () => {
  it("catches chat #273's closing sentence — a readiness claim followed by the end of the turn", () => {
    expect(announcesDeliverable("I have enough to write the ≤800-word alignment report.")).toBe(true);
    expect(announcesDeliverable("Read the four PRDs and the roadmap.\n\nI have enough to write the ≤800-word alignment report.")).toBe(true);
  });

  it("catches forward promises to produce the deliverable", () => {
    for (const text of [
      "The gaps are clear. Next I'll write the report.",
      "Let me now write the report.",
      "I'm going to draft the summary next.",
      "Now I will put together the migration plan.",
    ]) {
      expect(announcesDeliverable(text), text).toBe(true);
    }
  });

  it("leaves a delivered answer, an offer, a question and a negated claim alone", () => {
    for (const text of [
      "## Alignment report\n\nThe roadmap and the PRDs agree on scope; two gaps remain (see below).\n\n- Gap A\n- Gap B",
      "Report written to docs/alignment.md. Let me know if you want changes.",
      "If you'd like, I'll write the tests next.",
      "Would you like me to write the report now?",
      "I don't have enough to write the report yet: the PRD folder is empty.",
      "Should I write the report?",
    ]) {
      expect(announcesDeliverable(text), text).toBe(false);
    }
  });

  it("leaves a finished report that closes on a next step, a list item or deferred work alone", () => {
    const report =
      "## Endpoint review\n\nThe auth and billing endpoints now validate their bodies, and the tests cover both. " +
      "The tenant endpoints still accept unvalidated input; I listed them below.\n\n- /api/tenants\n- /api/tenants/:id\n\n";
    for (const text of [
      `${report}Next, I'll implement the remaining endpoints.`,
      "Changes are in.\n\n- I'll create the migration in a follow-up PR",
      "I'll write the docs in a separate ticket.",
      "I'll build the dashboard later.",
      "x".repeat(420) + ". Next I'll write the report.",
    ]) {
      expect(announcesDeliverable(text), text.slice(-60)).toBe(false);
    }
  });

  it("only reads the sign-off: an announcement early in a finished answer is not one", () => {
    const text = "Let me write the report.\n\nThe report: everything aligns.\n\nScope matches.\n\nNo gaps found.";
    expect(announcesDeliverable(text)).toBe(false);
  });
});
