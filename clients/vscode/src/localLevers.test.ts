import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { researchCacheKey } from "@builderforce/agent-tools";
import { hostCostLeverOn, setHostInstallId } from "./hostCostLevers";
import { preSearchBlock, whereDefinedAnswer, withPreSearch } from "./contextPack/preSearchSource";
import { fileResearchStore } from "./localResearch/researchCacheStore";
import { workspaceFingerprints } from "./localResearch/researchCapability";
import { setLocalResearchPort, withLocalResearch } from "./localResearch/researchPort";

describe("hostCostLeverOn — install-id bucketing", () => {
  afterEach(() => setHostInstallId(null));

  it("a partial lever is off without an install id and bucketed with one", () => {
    setHostInstallId(null);
    expect(hostCostLeverOn("c8_token_compression")).toBe(false);
    expect(hostCostLeverOn("b1_stable_prefix")).toBe(true);
    // Across many installs a 10% lever reaches some of them — never none.
    let on = 0;
    for (let i = 0; i < 400; i++) {
      setHostInstallId(`machine-${i}`);
      if (hostCostLeverOn("c8_token_compression")) on++;
    }
    expect(on).toBeGreaterThan(0);
    expect(on).toBeLessThan(400);
  });

  it("treats VS Code's placeholder machine id as no id", () => {
    setHostInstallId("someValue.machineId");
    expect(hostCostLeverOn("c8_token_compression")).toBe(false);
  });
});

describe("withPreSearch", () => {
  const pack = { block: "## Focus files\n…", recallHint: "a.ts", servedReads: [] };

  it("appends the hits as their own section", async () => {
    const r = await withPreSearch(Promise.resolve(pack), Promise.resolve("## Pre-search\n- hit"));
    expect(r?.block).toBe("## Focus files\n…\n\n## Pre-search\n- hit");
    expect(r?.recallHint).toBe("a.ts");
  });

  it("is a pack of only hits when the pack had nothing, and the pack unchanged without hits", async () => {
    expect((await withPreSearch(Promise.resolve(undefined), Promise.resolve("## Pre-search")))?.block).toBe("## Pre-search");
    expect(await withPreSearch(Promise.resolve(pack), Promise.resolve(""))).toBe(pack);
    expect(await withPreSearch(Promise.resolve(undefined), Promise.reject(new Error("rg gone")))).toBeUndefined();
  });
});

describe("workspace pre-search and the model-free where-answer", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "bf-levers-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "auth.ts"), "export function resolveMembership() {}\n");
    await fs.writeFile(path.join(root, "src", "routes.ts"), "import { resolveMembership } from './auth';\nresolveMembership();\n");
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("finds the definition and its uses before turn 1", async () => {
    const block = await preSearchBlock(root, "why does resolveMembership fail?", 10_000);
    expect(block).toContain("`resolveMembership` defined at src/auth.ts:1");
    expect(block).toContain("src/routes.ts:2");
  });

  it("answers a pure where-question from the index, and nothing else", async () => {
    expect(await whereDefinedAnswer(root, "where is resolveMembership defined?", 10_000)).toContain("src/auth.ts:1");
    expect(await whereDefinedAnswer(root, "where is resolveMembership defined and who calls it?", 10_000)).toBeUndefined();
    expect(await whereDefinedAnswer(root, "where is missingThing defined?", 10_000)).toBeUndefined();
  });

  it("fingerprints files under the root and leaves out what is missing or outside", async () => {
    const prints = await workspaceFingerprints(root, ["src/auth.ts", "src/nope.ts", "../escape.ts"]);
    expect(prints.map((p) => p.path)).toEqual(["src/auth.ts"]);
    expect(prints[0]!.size).toBeGreaterThan(0);
  });
});

describe("the research answer cache on disk", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "bf-research-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("persists answers and reloads them in a new process; a changed file misses", async () => {
    const file = path.join(dir, ".builderforce", "research-cache.json");
    const key = researchCacheKey("q", [{ path: "a.ts", mtimeMs: 1, size: 10 }]);
    await fileResearchStore(file).set(key, "the answer");
    const reloaded = fileResearchStore(file);
    expect(await reloaded.get(key)).toBe("the answer");
    expect(await reloaded.get(researchCacheKey("q", [{ path: "a.ts", mtimeMs: 2, size: 10 }]))).toBeUndefined();
  });

  it("stays bounded", async () => {
    const store = fileResearchStore(path.join(dir, "c.json"), 2);
    await store.set("k1", "a1");
    await store.set("k2", "a2");
    await store.set("k3", "a3");
    expect(await store.get("k1")).toBeUndefined();
    expect(await fileResearchStore(path.join(dir, "c.json"), 2).get("k3")).toBe("a3");
  });
});

describe("local_research advertising", () => {
  afterEach(() => setLocalResearchPort(null));
  const defs = [{ name: "read_file" }, { name: "local_research" }];

  it("is withheld with no port, or a port with no local model", async () => {
    expect((await withLocalResearch(defs)).map((d) => d.name)).toEqual(["read_file"]);
    setLocalResearchPort({ available: async () => false, complete: async () => "" });
    expect((await withLocalResearch(defs)).map((d) => d.name)).toEqual(["read_file"]);
  });

  it("is advertised while a local model can answer", async () => {
    setLocalResearchPort({ available: async () => true, complete: async () => "" });
    expect((await withLocalResearch(defs)).map((d) => d.name)).toEqual(["read_file", "local_research"]);
  });
});
