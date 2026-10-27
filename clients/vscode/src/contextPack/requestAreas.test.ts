import { describe, expect, it, vi } from "vitest";
import { extractIdentifiers } from "@builderforce/agent-tools";
import { areasNamed } from "./codemapFacts";
import { areasOfIdentifiers, codemapFactsForRequest } from "./requestAreas";
import { requestSymbolLookup } from "./requestSymbols";
import { withinMs } from "./withinMs";

/** A symbol index double: `find` answers from a fixed definition list. */
function symbolsOf(defs: Array<{ name: string; path: string }>, delayMs = 0) {
  return {
    find: vi.fn(async (query: string) => {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const matches = defs
        .filter((d) => d.name.toLowerCase().includes(query.toLowerCase()))
        .map((d) => ({ ...d, line: 1, kind: "function" as const, exported: true }));
      return { ok: true, query, total: matches.length, matches };
    }),
  };
}

const FACTS = [
  { key: "codemap:clients/vscode/src/contextPack", content: "context pack map" },
  { key: "codemap:brain-embedded/src/runStore", content: "run store map" },
  { key: "codemap:(root)", content: "root map" },
  { key: "learned:x", content: "not a map" },
];

describe("the request's identifiers (extractIdentifiers, shared with the pre-search)", () => {
  it("keeps camel, Pascal-with-humps and snake identifiers, not plain words", () => {
    expect(extractIdentifiers("Fix buildContextPack so RunKnowledgeRecorder sees run_store and MAX_FILES, not Canvas")).toEqual([
      "buildContextPack",
      "RunKnowledgeRecorder",
      "run_store",
      "MAX_FILES",
    ]);
    expect(extractIdentifiers("why is the canvas slow")).toEqual([]);
  });

  it("keeps a digit-humped identifier the area rule used to find", () => {
    expect(extractIdentifiers("fix base64Encode, not B2B")).toEqual(["base64Encode"]);
  });
});

describe("withinMs", () => {
  it("is the work when it is on time, the fallback when it is late or fails", async () => {
    expect(await withinMs(Promise.resolve(1), 50, 0)).toBe(1);
    expect(await withinMs(new Promise<number>((r) => setTimeout(() => r(1), 200)), 10, 0)).toBe(0);
    expect(await withinMs(Promise.reject(new Error("x")), 50, 0)).toBe(0);
  });
});

describe("requestSymbolLookup — one look-up per name per run", () => {
  it("asks the index once and gives each caller its own slice", async () => {
    const defs = Array.from({ length: 8 }, (_, i) => ({ name: "runLoop", path: `brain-embedded/src/runStore/r${i}.ts` }));
    const index = symbolsOf(defs);
    const shared = requestSymbolLookup(index);
    const [pre, areas] = await Promise.all([shared.find("runLoop", { limit: 20 }), shared.find("runLoop", { limit: 5 })]);
    expect(index.find).toHaveBeenCalledTimes(1);
    expect(index.find).toHaveBeenCalledWith("runLoop", { limit: 20 });
    expect(pre.matches).toHaveLength(8);
    expect(areas.matches).toHaveLength(5);
  });

  it("serves the pack's areas from the same answers the pre-search asked for", async () => {
    const index = symbolsOf([{ name: "buildContextPack", path: "clients/vscode/src/contextPack/buildContextPack.ts" }]);
    const shared = requestSymbolLookup(index);
    await shared.find("buildContextPack", { limit: 20 });
    expect(await areasOfIdentifiers(shared, extractIdentifiers("Make buildContextPack faster"))).toEqual(["clients/vscode/src/contextPack"]);
    expect(index.find).toHaveBeenCalledTimes(1);
  });

  it("does not memoise a failure", async () => {
    let calls = 0;
    const shared = requestSymbolLookup({
      find: async () => {
        calls++;
        if (calls === 1) throw new Error("index cold");
        return { ok: true, matches: [] };
      },
    });
    await expect(shared.find("x")).rejects.toThrow("index cold");
    expect((await shared.find("x")).ok).toBe(true);
  });
});

describe("areasOfIdentifiers", () => {
  it("maps each identifier to the directory that DEFINES it (exact name only)", async () => {
    const symbols = symbolsOf([
      { name: "buildContextPack", path: "clients/vscode/src/contextPack/buildContextPack.ts" },
      { name: "buildContextPackLegacy", path: "old/legacy/x.ts" },
      { name: "runLoop", path: "brain-embedded/src/runStore/runLoop.ts" },
    ]);
    expect(await areasOfIdentifiers(symbols, ["buildContextPack", "runLoop"])).toEqual([
      "clients/vscode/src/contextPack",
      "brain-embedded/src/runStore",
    ]);
  });

  it("gives up on a slow index instead of holding the pack", async () => {
    const symbols = symbolsOf([{ name: "runLoop", path: "brain-embedded/src/runStore/runLoop.ts" }], 200);
    expect(await areasOfIdentifiers(symbols, ["runLoop"], 10)).toEqual([]);
  });
});

describe("codemapFactsForRequest", () => {
  it("finds the map for an area the request names only by identifier", async () => {
    const recall = vi.fn(async () => FACTS);
    const facts = await codemapFactsForRequest(
      { request: "Make buildContextPack faster", focusPaths: [], focusContents: [] },
      { recall, symbols: symbolsOf([{ name: "buildContextPack", path: "clients/vscode/src/contextPack/buildContextPack.ts" }]) },
    );
    expect(facts.map((f) => f.content)).toEqual(["context pack map"]);
    expect(recall).toHaveBeenCalledWith(expect.stringContaining("clients/vscode/src/contextPack"), 20);
  });

  it("finds the map for an area the request names only by word", async () => {
    const facts = await codemapFactsForRequest(
      { request: "the run store drops a steer", focusPaths: [], focusContents: [] },
      { recall: async () => FACTS },
    );
    expect(facts.map((f) => f.content)).toEqual(["run store map"]);
  });

  it("finds the root map for a root-level focus file", async () => {
    expect(areasNamed(["package.json"], [])).toEqual(["(root)"]);
    const facts = await codemapFactsForRequest(
      { request: "bump package.json", focusPaths: ["package.json"], focusContents: [] },
      { recall: async () => FACTS },
    );
    expect(facts.map((f) => f.content)).toEqual(["root map"]);
  });

  it("returns nothing, and asks nothing, for an empty request with no focus", async () => {
    const recall = vi.fn(async () => FACTS);
    expect(await codemapFactsForRequest({ request: "  ", focusPaths: [], focusContents: [] }, { recall })).toEqual([]);
    expect(recall).not.toHaveBeenCalled();
  });

  it("never returns a map for an area the request does not name", async () => {
    const facts = await codemapFactsForRequest(
      { request: "why is the canvas slow", focusPaths: [], focusContents: [] },
      { recall: async () => FACTS },
    );
    expect(facts).toEqual([]);
  });
});
