import { describe, expect, it } from "vitest";
import type { MatcherContext } from "./matchers.js";
import { RULE_MATCHERS } from "./matchers.js";
import { runPrefilters } from "./prefilter.js";
import { summarizeFindings, type GovernanceRule, type ResolvedRuleset } from "./types.js";

function ctxOf(tree: Record<string, string>): MatcherContext {
  return {
    files: Object.keys(tree).sort(),
    readFile: async (rel) => (rel in tree ? (tree[rel] ?? null) : null),
  };
}

function rule(ruleRef: string, check: GovernanceRule["check"], severity = "high"): GovernanceRule {
  return { ruleRef, title: `Rule ${ruleRef}`, severity, check };
}

async function prefilter(tree: Record<string, string>, rules: GovernanceRule[]) {
  const ruleset: ResolvedRuleset = { rules };
  const result = await runPrefilters(ctxOf(tree), ruleset);
  return { ...result, ...summarizeFindings(ruleset, result.hits, result.ruleErrors) };
}

describe("governance matchers", () => {
  it("registers one matcher per documented check kind", () => {
    expect(Object.keys(RULE_MATCHERS).sort()).toEqual(
      ["dependency", "glob", "path_forbidden", "path_required", "regex", "secret"].sort(),
    );
  });

  it("regex: reports the first matching line per file", async () => {
    const out = await prefilter(
      { "src/a.ts": "ok\nconsole.log(1)\nconsole.log(2)", "src/b.ts": "clean" },
      [rule("R1", { kind: "regex", pattern: "console\\.log" })],
    );
    expect(out.hits).toHaveLength(1);
    expect(out.hits[0]).toMatchObject({ ruleRef: "R1", filePath: "src/a.ts", line: 2, source: "prefilter" });
    expect(out.ruleErrors).toEqual([]);
  });

  it("regex: honours a directory-prefix paths scope", async () => {
    const out = await prefilter(
      { "src/a.ts": "TODO", "docs/a.md": "TODO" },
      [rule("R1", { kind: "regex", pattern: "TODO", paths: ["src/"] })],
    );
    expect(out.hits.map((h) => h.filePath)).toEqual(["src/a.ts"]);
  });

  it("secret: built-in patterns catch an AWS key when the rule names no pattern", async () => {
    const out = await prefilter(
      { "config.ts": "const k = 'AKIAABCDEFGHIJKLMNOP';" },
      [rule("S1", { kind: "secret" })],
    );
    expect(out.hits).toHaveLength(1);
    expect(out.hits[0]?.detail).toContain("aws-access-key");
  });

  it("glob: flags files whose PATH matches the glob", async () => {
    const out = await prefilter(
      { "a/prod.env": "X=1", "src/index.ts": "" },
      [rule("G1", { kind: "glob", pattern: "*.env" })],
    );
    expect(out.hits.map((h) => h.filePath)).toEqual(["a/prod.env"]);
  });

  it("path_forbidden: flags each matching path", async () => {
    const out = await prefilter(
      { "secrets/key.pem": "", "src/a.ts": "" },
      [rule("F1", { kind: "path_forbidden", pattern: "secrets/**" })],
    );
    expect(out.hits.map((h) => h.filePath)).toEqual(["secrets/key.pem"]);
  });

  it("path_required: hits only when no file matches", async () => {
    const present = await prefilter({ "SECURITY.md": "" }, [rule("Q1", { kind: "path_required", pattern: "SECURITY.md" })]);
    expect(present.hits).toEqual([]);
    expect(present.summary.passed).toBe(1);
    const missing = await prefilter({ "README.md": "" }, [rule("Q1", { kind: "path_required", pattern: "SECURITY.md" })]);
    expect(missing.hits).toHaveLength(1);
    expect(missing.hits[0]?.filePath).toBeUndefined();
  });

  it("dependency: flags a forbidden package in any package.json", async () => {
    const out = await prefilter(
      {
        "package.json": JSON.stringify({ dependencies: { lodash: "^4" } }),
        "packages/x/package.json": JSON.stringify({ devDependencies: { "left-pad": "1.0.0" } }),
      },
      [rule("D1", { kind: "dependency", pattern: "left-pad" })],
    );
    expect(out.hits.map((h) => h.filePath)).toEqual(["packages/x/package.json"]);
  });

  it("unknown kind and check-less rules are LLM-only: no hit, no error", async () => {
    const out = await prefilter({ "a.ts": "" }, [rule("L1", { kind: "semantic" }), rule("L2", null)]);
    expect(out.hits).toEqual([]);
    expect(out.ruleErrors).toEqual([]);
  });

  it("regression: unknown check kind silently passed", async () => {
    // A typo kind used to be treated as LLM-only and, under the confirm-all assessor, counted passed.
    const out = await prefilter({ "a.ts": "" }, [rule("T1", { kind: "regx", pattern: "x" }, "blocker")]);
    expect(out.hits).toEqual([]);
    expect(out.ruleErrors).toMatchObject([{ ruleRef: "T1", kind: "regx" }]);
    expect(out.ruleErrors[0]?.error).toMatch(/unknown check kind/);
    expect(out.summary).toMatchObject({ passed: 0, errored: 1 });
    expect(out.gateResult).toBe("blocked");
  });

  it("regression: glob check compiled as regex", async () => {
    // `**/*.env` is not a valid regex; it used to compile to null and skip the rule (reported passed).
    const out = await prefilter(
      { ".env": "SECRET=1", "apps/web/.env": "SECRET=2", "src/index.ts": "" },
      [rule("G2", { kind: "glob", pattern: "**/*.env" })],
    );
    expect(out.ruleErrors).toEqual([]);
    expect(out.hits.map((h) => h.filePath)).toEqual([".env", "apps/web/.env"]);
    expect(out.summary.passed).toBe(0);
  });

  it("regression: invalid regex silently passed", async () => {
    // An invalid `secret` regex used to become /$^/ (matches nothing) and an invalid `regex` was skipped —
    // both reported the rule as passed. Now each is an ERROR result.
    const out = await prefilter(
      { "a.ts": "anything" },
      [
        rule("E1", { kind: "secret", pattern: "(unclosed" }, "blocker"),
        rule("E2", { kind: "regex", pattern: "[bad" }),
        rule("E3", { kind: "dependency" }),
      ],
    );
    expect(out.hits).toEqual([]);
    expect(out.ruleErrors.map((e) => e.ruleRef)).toEqual(["E1", "E2", "E3"]);
    expect(out.ruleErrors[0]?.error).toMatch(/invalid regex/);
    expect(out.ruleErrors[2]?.error).toMatch(/no pattern/);
    expect(out.summary.passed).toBe(0);
    expect(out.summary.errored).toBe(3);
    // An unchecked BLOCKER rule must not let a merge through.
    expect(out.gateResult).toBe("blocked");
  });
});
