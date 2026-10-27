import * as fs from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDesktopFetchForTests } from "@builderforce/agent-tools/node-desktop.js";
import { CORE_PACKAGE_NAME } from "../infra/package-names.js";
import { catalogConvergedFileTools } from "./converged-coding-tools.js";
import { catalogNodeCapabilityProvider } from "./node-capability-provider.js";
import {
  isLocalIndexSemantic,
  localIndexSemantic,
  resolveOnPremSemantic,
  withoutUnbackedSemanticTools,
} from "./on-prem-semantic.js";
import { onPremTreeSitterDir } from "./on-prem-symbol-index.js";
import { TREE_SITTER_DIST_DIR } from "./tree-sitter-dist.js";

/** A Desktop that is not running: no discovery file, so every probe fails. */
function absentDesktop() {
  return async (): Promise<Response> => new Response("{}", { status: 503 });
}

describe("on-prem repo_map without Builderforce Desktop", () => {
  let root: string;
  let dir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bf-onprem-map-"));
    dir = fs.mkdtempSync(join(tmpdir(), "bf-desktop-"));
    process.env.BUILDERFORCE_DESKTOP_DISCOVERY = join(dir, "desktop.json");
    setDesktopFetchForTests(absentDesktop());
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "src", "billing.ts"),
      "export function chargeInvoice(id: string) {\n  return id;\n}\n\nexport class LedgerWriter {}\n",
    );
  });
  afterEach(async () => {
    setDesktopFetchForTests(null);
    delete process.env.BUILDERFORCE_DESKTOP_DISCOVERY;
    fs.rmSync(dir, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  it("resolves the definition index as the backing and marks it local", async () => {
    const semantic = await resolveOnPremSemantic(root);
    expect(isLocalIndexSemantic(semantic)).toBe(true);
    const map = await semantic.repoMap({ maxTokens: 800 });
    expect(map.ok).toBe(true);
    expect(map.map).toContain("src/billing.ts");
    expect(map.map).toContain("chargeInvoice");
  });

  it("advertises repo.semantic on the catalog provider, backed by the index", async () => {
    const provider = await catalogNodeCapabilityProvider({ workspaceRoot: root });
    expect(provider.capabilities.has("repo.semantic")).toBe(true);
    expect(provider.capabilities.has("repo.compress")).toBe(false);
    expect(isLocalIndexSemantic(provider.semantic)).toBe(true);
  });

  it("offers repo_map and withholds semantic_search in the converged catalog", async () => {
    const tools = await catalogConvergedFileTools({ workspaceRoot: root });
    const names = tools.map((t) => t.name);
    expect(names).toContain("repo_map");
    expect(names).not.toContain("semantic_search");
    expect(names).not.toContain("read_compressed");
    const repoMap = tools.find((t) => t.name === "repo_map")!;
    const result = await repoMap.execute("call-1", { query: "invoice" }, undefined as unknown as AbortSignal);
    const text = result.content.find((b) => b.type === "text") as { text: string };
    const data = JSON.parse(text.text) as { ok: boolean; map: string };
    expect(data.ok).toBe(true);
    expect(data.map).toContain("chargeInvoice");
  });
});

describe("withoutUnbackedSemanticTools", () => {
  const tools = [{ name: "semantic_search" }, { name: "repo_map" }, { name: "write" }];

  it("drops semantic_search only for the definition-index backing", () => {
    expect(withoutUnbackedSemanticTools(tools, localIndexSemantic(tmpdir())).map((t) => t.name)).toEqual([
      "repo_map",
      "write",
    ]);
    const desktopLike = { search: async () => ({ ok: true }), repoMap: async () => ({ ok: true }) };
    expect(withoutUnbackedSemanticTools(tools, desktopLike).map((t) => t.name)).toEqual([
      "semantic_search",
      "repo_map",
      "write",
    ]);
    expect(withoutUnbackedSemanticTools(tools, undefined)).toHaveLength(3);
  });
});

describe("onPremTreeSitterDir", () => {
  let pkg: string;

  beforeEach(async () => {
    pkg = await mkdtemp(join(tmpdir(), "bf-onprem-pkg-"));
    await writeFile(join(pkg, "package.json"), JSON.stringify({ name: CORE_PACKAGE_NAME }));
    await mkdir(join(pkg, "dist"), { recursive: true });
  });
  afterEach(async () => {
    await rm(pkg, { recursive: true, force: true });
  });

  const opts = () => ({ moduleUrl: pathToFileURL(join(pkg, "dist", "chunk.js")).href, argv1: "", cwd: pkg });

  it("points at the shipped dist/tree-sitter when the runtime wasm is there", async () => {
    const wasmDir = join(pkg, "dist", TREE_SITTER_DIST_DIR);
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, "tree-sitter.wasm"), "");
    expect(onPremTreeSitterDir(opts())).toBe(wasmDir);
  });

  it("is undefined without a shipped wasm (the extractor resolves its packages, else regex)", () => {
    expect(onPremTreeSitterDir(opts())).toBeUndefined();
  });
});
