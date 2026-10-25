import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { areasNamed, codemapFactsFor } from "./codemapFacts";
import { asPathToken, extractFocusPaths, resolveUnderRoot, workspaceRelative } from "./focusPaths";
import { unresolvedByoEntries } from "./byoPreflightVerdict";
import { contextPackRecallHint, renderContextPack, type ContextPackParts } from "./renderContextPack";

describe("extractFocusPaths", () => {
  it("finds the paths a request names, quoted, listed or with a line reference", () => {
    expect(
      extractFocusPaths("Review docs/specs/35-prd-one-agent-one-kernel.md and implement it using subagents. See `clients/vscode/src/bfApi.ts:584`, (README.md).")
    ).toEqual(["docs/specs/35-prd-one-agent-one-kernel.md", "clients/vscode/src/bfApi.ts", "README.md"]);
  });

  it("ignores URLs, versions, plain words and e.g.", () => {
    expect(extractFocusPaths("see https://x.dev/a.md, bump to 1.2.3, e.g. this or that")).toEqual([]);
    expect(asPathToken("package.json")).toBe("package.json");
    expect(asPathToken("clients/vscode/src")).toBe("clients/vscode/src");
  });

  it("dedupes and caps", () => {
    expect(extractFocusPaths("a.ts A.ts b.ts c.ts", 2)).toEqual(["a.ts", "b.ts"]);
  });
});

describe("resolveUnderRoot", () => {
  const root = path.resolve("/ws");
  it("keeps paths inside the workspace and refuses escapes", () => {
    expect(resolveUnderRoot(root, "docs/a.md")).toBe(path.join(root, "docs", "a.md"));
    expect(resolveUnderRoot(root, "../etc/passwd")).toBeUndefined();
    expect(resolveUnderRoot("", "a.md")).toBeUndefined();
    expect(workspaceRelative(root, path.join(root, "docs", "a.md"))).toBe("docs/a.md");
  });
});

describe("codemap facts for a pack", () => {
  it("takes the areas from the focus files and the code paths they name", () => {
    expect(areasNamed(["docs/specs/35.md"], ["Touches `brain-embedded/src/runStore/dispatchTool.ts` and C:/abs/x.ts"])).toEqual([
      "docs/specs",
      "brain-embedded/src/runStore",
    ]);
  });

  it("keeps overlapping codemap facts only, most specific first, capped", () => {
    const facts = [
      { key: "codemap:brain-embedded/src", content: "wide" },
      { key: "learned:x", content: "not a map" },
      { key: "codemap:brain-embedded/src/runStore", content: "narrow" },
      { key: "codemap:api/src", content: "elsewhere" },
    ];
    expect(codemapFactsFor(facts, ["brain-embedded/src/runStore"]).map((f) => f.content)).toEqual(["narrow", "wide"]);
    expect(codemapFactsFor(facts, ["brain-embedded/src/runStore"], 1).map((f) => f.content)).toEqual(["narrow"]);
    expect(codemapFactsFor(facts, [])).toEqual([]);
  });
});

describe("renderContextPack", () => {
  const parts: ContextPackParts = {
    focus: [
      { path: "docs/small.md", totalLines: 2, content: "# Title\nbody", outline: [{ heading: "Title", line: 1 }] },
      { path: "docs/big.md", totalLines: 900, outline: [{ heading: "1. The rule", line: 17 }, { heading: "2. Why", line: 33 }] },
    ],
    chat: { tickets: [{ kind: "task", ref: "2861", label: "S2", status: "backlog" }], runs: [] },
    repos: [{ repo: "Builderforce.ai", branch: "main", ahead: 2, dirty: ["a.ts"], dirtyTotal: 1 }],
    facts: [{ key: "codemap:docs", content: "Open these first" }],
  };

  it("inlines small files, outlines large ones, and carries chat, git and facts", () => {
    const { block, dropped } = renderContextPack(parts);
    expect(dropped).toEqual([]);
    expect(block).toContain("whole file — do not read it again");
    expect(block).toContain("# Title\nbody");
    expect(block).toContain("- L17 1. The rule");
    expect(block).toContain("task 2861: S2 — backlog");
    expect(block).toContain("(nothing has run for this chat)");
    expect(block).toContain("- Builderforce.ai: main (ahead 2) — 1 uncommitted: a.ts");
    expect(block).toContain("#### codemap:docs");
  });

  it("drops the largest part first and says what it dropped", () => {
    const huge: ContextPackParts = { ...parts, focus: [{ path: "docs/huge.md", totalLines: 1, content: "x".repeat(40_000) }, ...parts.focus] };
    const { block, dropped } = renderContextPack(huge, 32_000);
    expect(dropped).toEqual(["focus file docs/huge.md"]);
    expect(block).toContain("dropped to fit the pack: focus file docs/huge.md");
    expect(block.length).toBeLessThanOrEqual(32_000);
    expect(block).toContain("docs/small.md");
  });

  it("names the focus files it carries WHOLE — not the outlined, not the dropped (PRD 35 E2 ↔ E1)", () => {
    expect(renderContextPack(parts).inlined).toEqual(["docs/small.md"]);
    const huge: ContextPackParts = { ...parts, focus: [{ path: "docs/huge.md", totalLines: 1, content: "x".repeat(40_000) }, ...parts.focus] };
    expect(renderContextPack(huge, 32_000).inlined).toEqual(["docs/small.md"]);
  });

  it("renders nothing for an empty pack", () => {
    expect(renderContextPack({ focus: [], facts: [] })).toEqual({ block: "", dropped: [], inlined: [] });
  });

  it("gives recall the focus paths and their top headings", () => {
    expect(contextPackRecallHint(parts)).toBe("docs/small.md Title docs/big.md 1. The rule 2. Why");
  });
});

describe("unresolvedByoEntries", () => {
  it("names only the accounts whose credential does not resolve, in the header's form", () => {
    expect(
      unresolvedByoEntries([
        { provider: "anthropic", status: "expired" },
        { provider: "openai", status: "ready" },
        { provider: "kimi", status: "local_egress_required" },
        { provider: "xai", status: "revoked" },
        { provider: "qwen", status: "capacity" },
        { provider: "meta", status: "lookup_failed" },
        { provider: "anthropic", status: "expired" },
      ]),
    ).toEqual(["anthropic:expired", "xai:revoked"]);
  });
});
