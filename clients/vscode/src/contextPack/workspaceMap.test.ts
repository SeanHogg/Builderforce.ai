import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { groupByLockfileRoot, readPackageJson, renderWorkspaceMap, WORKSPACE_MAP_CHAR_CAP, type PackageDir } from "./workspaceMap";
import { invalidateWorkspaceMap, scanWorkspacePackages, snapshotIsFresh, workspaceMapFor } from "./workspaceMapScan";
import { renderContextPack } from "./renderContextPack";

/** The chat #60338 layout: a product folder with no package.json, a pnpm workspace beside a standalone npm package. */
const FIXTURE: Record<string, string> = {
  "Builderforce.ai/README.md": "# product",
  "Builderforce.ai/agent-runtime/package.json": JSON.stringify({ name: "agent-runtime", scripts: { "type-check": "tsc", test: "vitest", dev: "x" } }),
  "Builderforce.ai/agent-runtime/pnpm-workspace.yaml": "packages:\n  - extensions/*\n",
  "Builderforce.ai/agent-runtime/pnpm-lock.yaml": "lockfileVersion: 9\n",
  "Builderforce.ai/agent-runtime/extensions/a2a/package.json": JSON.stringify({ name: "@bf/a2a", scripts: { build: "tsup", lint: "eslint" } }),
  "Builderforce.ai/agent-runtime/extensions/a2a/src/nested/package.json": JSON.stringify({ name: "never-walked" }),
  "Builderforce.ai/agent-runtime/extensions/mcp/package.json": JSON.stringify({ name: "mcp" }),
  "Builderforce.ai/api/package.json": JSON.stringify({ name: "api", scripts: { typecheck: "tsc", test: "vitest", build: "wrangler" } }),
  "Builderforce.ai/api/package-lock.json": "{}",
  "Builderforce.ai/api/node_modules/dep/package.json": JSON.stringify({ name: "dep" }),
  "Builderforce.ai/api/dist/package.json": JSON.stringify({ name: "dist-copy" }),
  "Builderforce.ai/.git/package.json": JSON.stringify({ name: "git-internal" }),
  "tools/loose/package.json": JSON.stringify({ name: "loose", scripts: { build: "x" } }),
};

let root: string;

async function writeTree(base: string, files: Record<string, string>): Promise<void> {
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(base, ...rel.split("/"));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, text, "utf8");
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "bf-workspace-map-"));
  await writeTree(root, FIXTURE);
  invalidateWorkspaceMap();
});

afterEach(async () => {
  invalidateWorkspaceMap();
  await fs.rm(root, { recursive: true, force: true });
});

describe("readPackageJson", () => {
  it("keeps the map's scripts in their order, the name and the workspaces flag", () => {
    expect(readPackageJson(JSON.stringify({ name: "x", scripts: { lint: "a", build: "b", dev: "c" }, workspaces: ["p/*"] }))).toEqual({
      name: "x",
      scripts: ["build", "lint"],
      declaresWorkspaces: true,
    });
    expect(readPackageJson("not json")).toEqual({ scripts: [], declaresWorkspaces: false });
  });
});

describe("scanWorkspacePackages", () => {
  it("finds every package folder and skips node_modules, dist, dot folders and a package's src", async () => {
    const { dirs } = await scanWorkspacePackages(root);
    expect(dirs.map((d) => d.path).sort()).toEqual([
      "Builderforce.ai/agent-runtime",
      "Builderforce.ai/agent-runtime/extensions/a2a",
      "Builderforce.ai/agent-runtime/extensions/mcp",
      "Builderforce.ai/api",
      "tools/loose",
    ]);
    const runtime = dirs.find((d) => d.path === "Builderforce.ai/agent-runtime")!;
    expect(runtime).toMatchObject({ lockfiles: ["pnpm-lock.yaml"], pnpmWorkspace: true, scripts: ["type-check", "test"] });
  });

  it("stops at the depth bound", async () => {
    const { dirs } = await scanWorkspacePackages(root, 2);
    expect(dirs.map((d) => d.path).sort()).toEqual(["Builderforce.ai/agent-runtime", "Builderforce.ai/api", "tools/loose"]);
  });
});

describe("groupByLockfileRoot", () => {
  it("puts each package under the nearest lockfile root, and the rest under none", async () => {
    const { dirs } = await scanWorkspacePackages(root);
    const groups = groupByLockfileRoot(dirs).map((g) => [g.root?.path ?? null, g.members.map((m) => m.path)]);
    expect(groups).toEqual([
      ["Builderforce.ai/agent-runtime", ["Builderforce.ai/agent-runtime", "Builderforce.ai/agent-runtime/extensions/a2a", "Builderforce.ai/agent-runtime/extensions/mcp"]],
      ["Builderforce.ai/api", ["Builderforce.ai/api"]],
      [null, ["tools/loose"]],
    ]);
  });
});

describe("renderWorkspaceMap", () => {
  it("renders a compact table that marks where to install and names the scripts", async () => {
    const text = renderWorkspaceMap((await scanWorkspacePackages(root)).dirs);
    expect(text).toContain("#### Builderforce.ai/agent-runtime — pnpm-workspace.yaml + pnpm-lock.yaml — run `pnpm install` HERE");
    expect(text).toContain("- . [type-check test]");
    expect(text).toContain('- extensions/a2a "@bf/a2a" [build lint]');
    expect(text).toContain("- extensions/mcp\n");
    expect(text).toContain("#### Builderforce.ai/api — package-lock.json — run `npm install` HERE");
    expect(text).toContain("- . [typecheck test build]");
    expect(text).toContain("#### No lockfile root above these");
    expect(text).toContain("- tools/loose [build]");
    expect(text).not.toContain("never-walked");
    expect(text.length).toBeLessThanOrEqual(WORKSPACE_MAP_CHAR_CAP);
  });

  it("elides leaf packages with a count when the map overflows its cap", () => {
    const dirs: PackageDir[] = [
      { path: "rt", hasManifest: true, name: "rt", scripts: ["test"], lockfiles: ["pnpm-lock.yaml"], pnpmWorkspace: true, declaresWorkspaces: false },
      ...Array.from({ length: 80 }, (_, i): PackageDir => ({
        path: `rt/extensions/ext-${String(i).padStart(2, "0")}`, hasManifest: true, scripts: ["build", "test"], lockfiles: [], pnpmWorkspace: false, declaresWorkspaces: false,
      })),
    ];
    const text = renderWorkspaceMap(dirs);
    expect(text.length).toBeLessThanOrEqual(WORKSPACE_MAP_CHAR_CAP);
    expect(text).toContain("run `pnpm install` HERE");
    expect(text).toContain("- extensions/ext-00 [build test]");
    expect(text).toMatch(/- … \+\d+ more package\(s\) \(extensions\/\*\)/);
  });

  it("counts the lockfile roots it cannot fit", () => {
    const dirs: PackageDir[] = Array.from({ length: 60 }, (_, i): PackageDir => ({
      path: `services/svc-${i}`, hasManifest: true, scripts: [], lockfiles: ["package-lock.json"], pnpmWorkspace: false, declaresWorkspaces: false,
    }));
    const text = renderWorkspaceMap(dirs);
    expect(text.length).toBeLessThanOrEqual(WORKSPACE_MAP_CHAR_CAP);
    expect(text).toMatch(/… \+\d+ more lockfile root\(s\)$/);
  });

  it("is empty for a folder with no package", () => {
    expect(renderWorkspaceMap([])).toBe("");
  });

  it("rides the context pack as its own section", () => {
    const block = renderContextPack({ focus: [], facts: [], workspaceMap: "### Workspace map\n- api" }).block;
    expect(block).toContain("### Workspace map\n- api");
  });
});

describe("workspaceMapFor (cache)", () => {
  it("serves the cached map until a manifest, lockfile or package folder changes", async () => {
    const first = await workspaceMapFor(root);
    expect(first).toContain("Builderforce.ai/api");
    const snapshot = await scanWorkspacePackages(root);
    expect(await snapshotIsFresh(snapshot)).toBe(true);
    expect(await workspaceMapFor(root)).toBe(first);

    // An edited package.json (new script) invalidates.
    const apiPkg = path.join(root, "Builderforce.ai", "api", "package.json");
    await fs.writeFile(apiPkg, JSON.stringify({ name: "api", scripts: { typecheck: "tsc", test: "vitest", build: "w", lint: "eslint" } }), "utf8");
    await fs.utimes(apiPkg, new Date(), new Date(Date.now() + 5_000));
    expect(await snapshotIsFresh(snapshot)).toBe(false);
    expect(await workspaceMapFor(root)).toContain("- . [typecheck test build lint]");

    // A new package folder invalidates (its parent folder's mtime moves).
    await writeTree(root, { "Builderforce.ai/agent-runtime/extensions/fresh/package.json": JSON.stringify({ name: "fresh" }) });
    const extDir = path.join(root, "Builderforce.ai", "agent-runtime", "extensions");
    await fs.utimes(extDir, new Date(), new Date(Date.now() + 10_000));
    expect(await workspaceMapFor(root)).toContain("- extensions/fresh");
  });

  it("is empty without a root", async () => {
    expect(await workspaceMapFor("")).toBe("");
  });
});
