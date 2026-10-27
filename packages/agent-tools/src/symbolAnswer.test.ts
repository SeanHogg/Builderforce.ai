import { describe, expect, it } from "vitest";
import type { SymbolFindResult, SymbolMatch } from "./capabilities.js";
import { answerWhereDefined, whereDefinedTargets } from "./symbolAnswer.js";

const index = (defs: Record<string, SymbolMatch[]>) => {
  const asked: string[] = [];
  const find = async (name: string): Promise<SymbolFindResult> => {
    asked.push(name);
    const matches = defs[name] ?? [];
    return { ok: true, query: name, total: matches.length, matches };
  };
  return { asked, find };
};

const def = (name: string, path: string, line: number, kind: SymbolMatch["kind"] = "function"): SymbolMatch => ({ name, path, line, kind, exported: true });

describe("whereDefinedTargets", () => {
  it("reads the names a pure where-question asks about", () => {
    expect(whereDefinedTargets("where is resolveMembership defined?")).toEqual(["resolveMembership"]);
    expect(whereDefinedTargets("Where's `chargeCard`")).toEqual(["chargeCard"]);
    expect(whereDefinedTargets("which file defines BrainRunHost and SKIP_DIRS?")).toEqual(["BrainRunHost", "SKIP_DIRS"]);
    expect(whereDefinedTargets("where is the `billing.chargeCard` function")).toEqual(["chargeCard"]);
  });

  it("is not a lookup when the request asks for anything else", () => {
    expect(whereDefinedTargets("where is resolveMembership defined and why does it fail?")).toBeNull();
    expect(whereDefinedTargets("where is resolveMembership used")).toBeNull();
    expect(whereDefinedTargets("fix resolveMembership")).toBeNull();
    // A plain English word is not marked as code.
    expect(whereDefinedTargets("where is the router")).toBeNull();
    expect(whereDefinedTargets("where is resolveMembership defined?\nthen refactor it")).toBeNull();
  });
});

describe("answerWhereDefined", () => {
  it("answers with every exact definition when the index resolves every name — no model", async () => {
    const idx = index({
      BrainRunHost: [def("BrainRunHost", "clients/vscode/src/brainRunHostContract.ts", 170, "interface"), def("BrainRunHostPorts", "x.ts", 1, "interface")],
      SKIP_DIRS: [def("SKIP_DIRS", "clients/vscode/src/workspaceSearch.ts", 39, "const")],
    });
    const a = await answerWhereDefined("which file defines BrainRunHost and SKIP_DIRS?", idx.find);
    expect(a).toContain("`BrainRunHost` is defined at:");
    expect(a).toContain("clients/vscode/src/brainRunHostContract.ts:170 — interface `BrainRunHost`");
    expect(a).toContain("clients/vscode/src/workspaceSearch.ts:39 — const `SKIP_DIRS`");
    expect(a).not.toContain("BrainRunHostPorts");
  });

  it("returns null when any name has no exact definition, so the run asks the model", async () => {
    const idx = index({ BrainRunHost: [def("BrainRunHost", "a.ts", 1)], SKIP_DIRS: [def("SKIP_DIRS_EXTRA", "b.ts", 2)] });
    expect(await answerWhereDefined("which file defines BrainRunHost and SKIP_DIRS?", idx.find)).toBeNull();
  });

  it("never asks the index for a request that is not a where-question", async () => {
    const idx = index({});
    expect(await answerWhereDefined("refactor fooBar", idx.find)).toBeNull();
    expect(idx.asked).toEqual([]);
  });

  it("lists several definitions and counts the rest", async () => {
    const many = Array.from({ length: 7 }, (_, i) => def("handle", `src/h${i}.ts`, i + 1));
    const a = await answerWhereDefined("where is `handle` defined", index({ handle: many }).find);
    expect(a).toContain("`handle` is defined in:");
    expect(a).toContain("… and 2 more");
  });

  it("an index failure is a miss, never a throw", async () => {
    expect(await answerWhereDefined("where is fooBar", async () => { throw new Error("down"); })).toBeNull();
  });
});
