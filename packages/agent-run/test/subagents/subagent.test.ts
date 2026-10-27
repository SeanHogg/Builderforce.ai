import { describe, expect, it } from "vitest";
import { parseSubagentReport, subagentSystemPrompt } from "../../src/policy/subagents/index.js";

/**
 * A child runs BESIDE its owner on every surface: the owner is not blocked, may redirect
 * it, and reads its final message as the report — and it has no step budget.
 * Ported from `packages/agent-loop/src/subagent.test.ts`.
 */

const owner = { owner: "BuilderForce" };

describe("subagentSystemPrompt", () => {
  it("tells the child it is a clone — every tool its owner holds, the slice carried out end to end", () => {
    const prompt = subagentSystemPrompt(undefined, owner);
    expect(prompt).toMatch(/every tool your owner holds/);
    expect(prompt).not.toMatch(/READ-ONLY/);
  });

  it("says the owner sees only the final report — the reason it must stand alone", () => {
    expect(subagentSystemPrompt(undefined, owner)).toMatch(/must stand alone/);
  });

  it("names the owner and says it keeps working", () => {
    const prompt = subagentSystemPrompt(undefined, owner);
    expect(prompt).toContain("spawned by BuilderForce");
    expect(prompt).not.toContain("blocked until you answer");
  });

  it("tells the child how its owner's redirection arrives", () => {
    expect(subagentSystemPrompt(undefined, owner)).toContain('"[BuilderForce]"');
  });

  it("promises no step budget it does not have", () => {
    expect(subagentSystemPrompt(undefined, owner)).not.toContain("step budget");
  });
});

describe("the report a child ends with", () => {
  it("asks every child for the same four lines, Open issues last", () => {
    const prompt = subagentSystemPrompt(undefined, owner);
    for (const line of ["Outcome:", "Changed:", "Verified:", "Open issues:"]) expect(prompt).toContain(line);
  });

  it("tells a verify child to check, report failures verbatim, and leave the fixing to the coder", () => {
    const prompt = subagentSystemPrompt(undefined, { ...owner, role: "verify" });
    expect(prompt).toContain("CHECK the change, not to fix it");
    expect(prompt).toContain("Outcome: pass | fail");
    expect(prompt).toContain("failing output verbatim");
    expect(subagentSystemPrompt(undefined, owner)).not.toContain("CHECK the change");
  });
});

describe("parseSubagentReport", () => {
  it("reads every open issue, bulleted or numbered, and the outcome", () => {
    const r = parseSubagentReport(
      "Moved the drawer.\n\n**Outcome:** partial\nChanged: a.tsx\nVerified: tsc — pass\n**Open issues:**\n- b.tsx still imports the old modal\n2. no test for the empty state",
    );
    expect(r.outcome).toBe("partial");
    expect(r.openIssues).toEqual(["b.tsx still imports the old modal", "no test for the empty state"]);
  });

  it("reads an issue written on the heading line, and stops at the next heading", () => {
    const r = parseSubagentReport("Open issues: tests/a.test.ts:12 expected 1, received 0\nOutcome: fail");
    expect(r.openIssues).toEqual(["tests/a.test.ts:12 expected 1, received 0"]);
    expect(r.outcome).toBe("fail");
  });

  it("finds nothing to resolve when the report says none", () => {
    expect(parseSubagentReport("Outcome: done\nOpen issues: none").openIssues).toEqual([]);
    expect(parseSubagentReport("Outcome: pass\nOpen issues:\n- none").openIssues).toEqual([]);
  });

  it("keeps a verify child's verbatim failure as ONE issue, and stops at the blank line after the list", () => {
    const r = parseSubagentReport([
      "Outcome: fail",
      "Checked: npx tsc --noEmit — 1 error",
      "Open issues:",
      "- tsc: src/a.ts:4 — Type 'string' is not assignable",
      "  ```",
      "  src/a.ts(4,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      "",
      "  ```",
      "    at Object.<anonymous> (src/a.ts:4:7)",
      "",
      "Let me know if you want me to look further.",
    ].join("\n"));
    expect(r.openIssues).toHaveLength(1);
    expect(r.openIssues[0]).toContain("error TS2322");
    expect(r.openIssues[0]).toContain("at Object.<anonymous>");
    expect(r.openIssues[0]).not.toContain("Let me know");
  });

  it("reads the ways a clean report says none", () => {
    for (const none of ["None — all checks pass", "None identified.", "No open issues.", "Nothing outstanding", "N/A (out of scope)"]) {
      expect(parseSubagentReport(`Outcome: done\nOpen issues: ${none}`).openIssues).toEqual([]);
    }
  });

  it("does not mistake a real issue that starts with none or nothing for a clean report", () => {
    const r = parseSubagentReport("Open issues:\n- None of the tests ran\n- Nothing renders in Safari");
    expect(r.openIssues).toEqual(["None of the tests ran", "Nothing renders in Safari"]);
  });

  it("keeps a bulleted issue that starts like a heading, a counted heading, and ignores prose after Outcome", () => {
    const r = parseSubagentReport("Outcome: the drawer now slides\nOpen issues (2):\n- Changed: b.tsx but its test still fails\n- c.tsx untouched");
    expect(r.outcome).toBeUndefined();
    expect(r.openIssues).toEqual(["Changed: b.tsx but its test still fails", "c.tsx untouched"]);
  });

  it("caps what one report hands its owner", () => {
    const many = Array.from({ length: 12 }, (_, i) => `- issue ${i}`).join("\n");
    const r = parseSubagentReport(`Open issues:\n${many}`);
    expect(r.openIssues).toHaveLength(9);
    expect(r.openIssues[8]).toContain("4 more");
  });

  it("still flags a failed slice that named nothing left, and stays silent on a report without the lines", () => {
    expect(parseSubagentReport("Outcome: failed").openIssues).toHaveLength(1);
    expect(parseSubagentReport("I changed a.ts and it works.")).toEqual({ openIssues: [] });
  });
});

describe("subagentSystemPrompt with a persona", () => {
  const persona = { name: "Ada", brief: "You are Ada, the workspace's data engineer." };

  it("names the agent the child is acting as", () => {
    expect(subagentSystemPrompt(persona, owner)).toContain("acting as Ada");
  });

  it("puts the identity FIRST, so it frames the work rather than trailing it", () => {
    const prompt = subagentSystemPrompt(persona, owner);
    expect(prompt.indexOf("acting as Ada")).toBeLessThan(prompt.indexOf("sub-agent"));
  });

  it("changes the voice, never the procedure — the sub-agent rules all survive", () => {
    const prompt = subagentSystemPrompt(persona, owner);
    expect(prompt).toMatch(/every tool your owner holds/);
    expect(prompt).toMatch(/must stand alone/);
  });
});
