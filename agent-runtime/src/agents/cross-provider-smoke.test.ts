/**
 * THE CROSS-PROVIDER SMOKE TEST — the gate `tools.fs.convergedFileTools` was held OFF for.
 *
 * Convergence claims something specific: the on-prem disk provider and the cloud provider
 * are two BACKINGS of ONE tool contract, so the same shared `ToolDefinition` behaves the
 * same on both. Nothing checked that. `converged-coding-tools.test.ts` exercises the
 * on-prem backing against itself, and `api/…/cloudSurfaceCaps.test.ts` pins the cloud
 * surface's tool NAMES — neither compares the two, so a provider could satisfy the type
 * and still answer differently, and the flag stayed off because the claim was untested
 * rather than because it was false.
 *
 * This test drives the SHARED definitions over two providers built from the same registry:
 * the real on-prem `buildNodeCapabilityProvider` (against a temp directory), and an
 * in-memory reference provider standing in for a remote surface (the cloud provider itself
 * needs a Worker `Env`, a tenant and a git backend, which is not reachable from a unit
 * test — the reference implements the same `CapabilityProvider` interface over a Map, so
 * it isolates the CONTRACT from either surface's infrastructure).
 *
 * What it asserts is the part that must hold for the flag to be safe to default ON:
 *  - both providers advertise the same tool set for the same capability set;
 *  - a write → list → read → edit → delete sequence produces the same tool-visible
 *    results on both, field for field;
 *  - the failure modes agree too — a missing file, a non-unique edit, a delete of nothing.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type Capability,
  type CapabilityProvider,
  deleteFileTool,
  editFileTool,
  listFilesTool,
  readFileTool,
  type RepoDeleteResult,
  type RepoEditResult,
  type RepoListResult,
  type RepoReadResult,
  type RepoSearchResult,
  type RepoWriteResult,
  ToolRegistry,
  type ToolResult,
  writeFileTool,
} from "@builderforce/agent-tools";
import { applyStringEdit, filterByGlob } from "@builderforce/agent-tools";
import { buildNodeCapabilityProvider } from "./node-capability-provider.js";

/** The file capabilities both surfaces claim to back. */
const FILE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  "repo.read",
  "repo.write",
  "repo.edit",
  "repo.delete",
]);

/** The shared definitions under test — one registry, two providers. */
const REGISTRY = new ToolRegistry([
  writeFileTool,
  readFileTool,
  editFileTool,
  deleteFileTool,
  listFilesTool,
]);

/**
 * A remote-surface stand-in: the same `CapabilityProvider` interface over an in-memory
 * file map, written independently of the Node provider. It is deliberately NOT a wrapper
 * around the Node one — a test where both sides share an implementation proves nothing
 * about the contract.
 */
function buildMemoryProvider(files = new Map<string, string>()): CapabilityProvider {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
  const outside = (p: string) => norm(p).startsWith("../") || /^([a-zA-Z]:|\/)/.test(p);
  const escaped = (p: string) => ({ ok: false as const, error: `'${p}' is outside the workspace` });
  return {
    capabilities: FILE_CAPS,
    repoRead: {
      async listFiles(sub, glob): Promise<RepoListResult> {
        if (sub && outside(sub)) return escaped(sub);
        const prefix = sub ? `${norm(sub).replace(/\/$/, "")}/` : "";
        const paths = [...files.keys()].filter((p) => p.startsWith(prefix)).sort();
        return { ok: true, paths: glob ? filterByGlob(paths, glob) : paths, truncated: false };
      },
      async readFile(path): Promise<RepoReadResult> {
        if (outside(path)) return escaped(path);
        const content = files.get(norm(path));
        if (content === undefined) return { ok: false, error: `file not found: ${path}` };
        return { ok: true, path, content };
      },
      // Required by the capability, but `search_code` is not in this test's registry —
      // its two backings are a ripgrep shell-out and a git-index query, which have no
      // shared observable contract to compare.
      async searchCode(query): Promise<RepoSearchResult> {
        return { ok: true, query, total: 0, matches: [] };
      },
    },
    repoWrite: {
      async writeFile(path, content): Promise<RepoWriteResult> {
        if (outside(path)) return escaped(path);
        const existed = files.has(norm(path));
        files.set(norm(path), content);
        return { ok: true, change: existed ? "modified" : "created" };
      },
      async editFile(path, oldString, newString, replaceAll): Promise<RepoEditResult> {
        if (outside(path)) return escaped(path);
        const raw = files.get(norm(path));
        if (raw === undefined) return { ok: false, error: `file not found: ${path}` };
        const r = applyStringEdit(raw, oldString, newString, replaceAll === true);
        if (!r.ok || r.content === undefined) return { ok: false, error: r.error ?? "edit failed" };
        files.set(norm(path), r.content);
        return { ok: true, change: "modified", replaced: r.replaced };
      },
      async deleteFile(path): Promise<RepoDeleteResult> {
        if (outside(path)) return escaped(path);
        if (!files.has(norm(path))) {
          return { ok: true, deleted: false, note: `'${path}' does not exist, so there is nothing to delete.` };
        }
        files.delete(norm(path));
        return { ok: true, deleted: true };
      },
    },
  };
}

/** Dispatch a shared tool through a provider and return the model-visible payload. */
async function call(
  provider: CapabilityProvider,
  name: string,
  args: Record<string, unknown>,
  workspaceRoot?: string,
): Promise<Record<string, unknown>> {
  const result: ToolResult = await REGISTRY.dispatch(name, args, {
    caps: provider,
    ...(workspaceRoot ? { workspaceRoot } : {}),
  });
  return result.data;
}

describe("cross-provider parity — one shared contract, two backings", () => {
  let root: string;
  let node: CapabilityProvider;
  let memory: CapabilityProvider;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bf-xprovider-"));
    node = buildNodeCapabilityProvider({ workspaceRoot: root });
    memory = buildMemoryProvider();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Run one step against both providers and return both payloads. */
  const both = async (name: string, args: Record<string, unknown>) =>
    [await call(node, name, args, root), await call(memory, name, args)] as const;

  it("advertises the SAME tools for the same capability set", () => {
    const forNode = REGISTRY.toolsFor(node).map((t) => t.name).toSorted();
    const forMemory = REGISTRY.toolsFor(memory).map((t) => t.name).toSorted();
    expect(forNode).toEqual(forMemory);
    expect(forNode).toEqual(["delete_file", "edit_file", "list_files", "read_file", "write_file"]);
  });

  it("agrees on a write → list → read → edit → delete lifecycle", async () => {
    const [wn, wm] = await both("write_file", { path: "src/a.ts", content: "const v = 1;\n" });
    expect(wn).toEqual(wm);
    expect(wn.ok).toBe(true);

    const [ln, lm] = await both("list_files", {});
    expect(ln.ok).toBe(true);
    expect(ln.paths).toEqual(lm.paths);
    expect(ln.paths).toContain("src/a.ts");

    const [rn, rm2] = await both("read_file", { path: "src/a.ts" });
    expect(rn.content).toEqual(rm2.content);
    expect(rn.content).toBe("const v = 1;\n");

    const [en, em] = await both("edit_file", {
      path: "src/a.ts",
      old_string: "const v = 1;",
      new_string: "const v = 2;",
    });
    expect(en).toEqual(em);
    expect(en.ok).toBe(true);

    const [rn2, rm3] = await both("read_file", { path: "src/a.ts" });
    expect(rn2.content).toEqual(rm3.content);
    expect(rn2.content).toBe("const v = 2;\n");

    const [dn, dm] = await both("delete_file", { path: "src/a.ts" });
    expect(dn).toEqual(dm);
    expect(dn.deleted).toBe(true);
  });

  it("re-writing an existing path succeeds identically on both", async () => {
    await both("write_file", { path: "a.txt", content: "one" });
    const [n, m] = await both("write_file", { path: "a.txt", content: "two" });
    expect(n).toEqual(m);
    expect(n.ok).toBe(true);
  });

  it("agrees that reading a missing file FAILS rather than returning empty", async () => {
    const [n, m] = await both("read_file", { path: "nope.ts" });
    expect(n.ok).toBe(false);
    expect(m.ok).toBe(false);
    expect(String(n.error)).toMatch(/not found/i);
    expect(String(m.error)).toMatch(/not found/i);
  });

  it("agrees that editing a missing file FAILS", async () => {
    const [n, m] = await both("edit_file", { path: "nope.ts", old_string: "a", new_string: "b" });
    expect(n.ok).toBe(false);
    expect(m.ok).toBe(false);
  });

  it("agrees that a non-unique edit is rejected unless replace_all is set", async () => {
    await both("write_file", { path: "d.txt", content: "x\nx\n" });
    const [n, m] = await both("edit_file", { path: "d.txt", old_string: "x", new_string: "y" });
    expect(n.ok).toBe(false);
    expect(m.ok).toBe(false);
    expect(String(n.error)).toMatch(/not unique/i);
    expect(String(m.error)).toMatch(/not unique/i);

    const [na, ma] = await both("edit_file", {
      path: "d.txt",
      old_string: "x",
      new_string: "y",
      replace_all: true,
    });
    expect(na).toEqual(ma);
    expect(na.ok).toBe(true);
    expect(na.replaced).toBe(2);
  });

  it("agrees that deleting a non-existent path is a benign no-op, not an error", async () => {
    // A model that reads `ok:false` here retries forever; both surfaces must say `ok:true`
    // with `deleted:false`, or the same prompt loops on one surface and not the other.
    const [n, m] = await both("delete_file", { path: "ghost.ts" });
    expect(n).toEqual(m);
    expect(n.ok).toBe(true);
    expect(n.deleted).toBe(false);
  });

  it("agrees that a workspace escape is refused on every mutating tool", async () => {
    for (const [name, args] of [
      ["write_file", { path: "../escape.txt", content: "x" }],
      ["edit_file", { path: "../escape.txt", old_string: "a", new_string: "b" }],
      ["delete_file", { path: "../escape.txt" }],
      ["read_file", { path: "../escape.txt" }],
    ] as const) {
      const [n, m] = await both(name, args as Record<string, unknown>);
      expect(n.ok, `${name} on node`).toBe(false);
      expect(m.ok, `${name} on memory`).toBe(false);
    }
  });

  it("agrees on glob filtering in list_files", async () => {
    for (const p of ["src/a.ts", "src/b.js", "docs/c.md"]) {
      await both("write_file", { path: p, content: "x" });
    }
    const [n, m] = await both("list_files", { glob: "src/**/*.ts" });
    expect(n.paths).toEqual(m.paths);
    expect(n.paths).toEqual(["src/a.ts"]);
  });
});
