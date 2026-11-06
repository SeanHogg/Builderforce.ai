import { afterEach, describe, expect, it } from "vitest";
import { KNOWLEDGE_PACKS_KEY, configureLoadedPacks, loadedPackRegistry } from "./loadedPackRegistry";
import { memoryMemento } from "./packFixture.test-util";

afterEach(() => configureLoadedPacks(memoryMemento()));

describe("the loaded-pack registry", () => {
  it("remembers packs under the one globalState key and lists them by name", async () => {
    const state = memoryMemento();
    configureLoadedPacks(state);
    const reg = loadedPackRegistry();
    await reg.remember("zeta", { path: "/p/zeta.bfpack", rootId: "r-z", title: "Zeta", loadedAt: "2026-11-06T00:00:00.000Z" });
    await reg.remember("alpha", { path: "/p/alpha.bfpack", rootId: "r-a", title: "Alpha", loadedAt: "2026-11-05T00:00:00.000Z" });
    expect(state.values.has(KNOWLEDGE_PACKS_KEY)).toBe(true);
    expect((await reg.list()).map((e) => [e.name, e.rootId, e.title, e.path])).toEqual([
      ["alpha", "r-a", "Alpha", "/p/alpha.bfpack"],
      ["zeta", "r-z", "Zeta", "/p/zeta.bfpack"],
    ]);
    expect(reg.byRootId("r-z")?.name).toBe("zeta");
    expect(reg.byRootId("nope")).toBeUndefined();
  });

  it("reads records written before titles existed (the title falls back to the name) and skips malformed ones", async () => {
    configureLoadedPacks(memoryMemento({
      [KNOWLEDGE_PACKS_KEY]: {
        old: { path: "/p/old.bfpack", rootId: "r-old", loadedAt: "2026-10-01T00:00:00.000Z" },
        broken: { rootId: "r-broken" },
        junk: null,
      },
    }));
    expect(loadedPackRegistry().all().map((e) => [e.name, e.title])).toEqual([["old", "old"]]);
  });

  it("keeps a pack's provenance in its record, for the pickers' detail line", async () => {
    configureLoadedPacks(memoryMemento());
    const reg = loadedPackRegistry();
    const provenance = { reviewedBy: "Ada", judgeModel: "m-1" };
    await reg.remember("docs", { path: "/d.bfpack", rootId: "vscode:f-d", loadedAt: "", provenance });
    expect(reg.recordOf("vscode:f-d")?.provenance).toEqual(provenance);
    await reg.remember("plain", { path: "/p.bfpack", rootId: "vscode:f-p", loadedAt: "" });
    expect(reg.recordOf("vscode:f-p")?.provenance).toBeUndefined();
  });

  it("keeps two folders of the same name apart: packs are keyed by root, not by name", async () => {
    configureLoadedPacks(memoryMemento());
    const reg = loadedPackRegistry();
    await reg.remember("docs", { path: "/a/docs.bfpack", rootId: "vscode:f-a", title: "docs", loadedAt: "" });
    await reg.remember("docs", { path: "/b/docs.bfpack", rootId: "vscode:f-b", title: "docs", loadedAt: "" });
    expect(reg.all().map((e) => [e.name, e.rootId, e.path])).toEqual([
      ["docs", "vscode:f-a", "/a/docs.bfpack"],
      ["docs", "vscode:f-b", "/b/docs.bfpack"],
    ]);
    await reg.remember("docs again", { path: "/a/docs2.bfpack", rootId: "vscode:f-a", title: "docs", loadedAt: "" });
    expect(reg.all()).toHaveLength(2);
    expect(reg.byRootId("vscode:f-a")?.path).toBe("/a/docs2.bfpack");
  });

  it("migrates a record keyed by name on the next write, and the root-keyed record wins a clash", async () => {
    const state = memoryMemento({
      [KNOWLEDGE_PACKS_KEY]: {
        docs: { path: "/old.bfpack", rootId: "vscode:f-a", title: "docs", loadedAt: "1" },
      },
    });
    configureLoadedPacks(state);
    const reg = loadedPackRegistry();
    expect(reg.byRootId("vscode:f-a")).toMatchObject({ name: "docs", path: "/old.bfpack" });
    await reg.remember("other", { path: "/o.bfpack", rootId: "vscode:f-o", loadedAt: "" });
    const stored = state.values.get(KNOWLEDGE_PACKS_KEY) as Record<string, { name: string; rootId: string }>;
    expect(Object.keys(stored)).not.toContain("docs");
    expect(Object.values(stored).map((r) => [r.name, r.rootId]).sort()).toEqual([["docs", "vscode:f-a"], ["other", "vscode:f-o"]]);
    await reg.remember("renamed", { path: "/new.bfpack", rootId: "vscode:f-a", loadedAt: "2" });
    expect(reg.all().filter((e) => e.rootId === "vscode:f-a")).toHaveLength(1);
  });

  it("forgets a pack by name or by root, and survives a missing or non-object state", async () => {
    configureLoadedPacks(memoryMemento({ [KNOWLEDGE_PACKS_KEY]: "garbage" }));
    expect(loadedPackRegistry().all()).toEqual([]);
    const reg = loadedPackRegistry();
    await reg.remember("a", { path: "/a", rootId: "r", loadedAt: "" });
    await reg.forget("a");
    expect(reg.all()).toEqual([]);
  });
});
