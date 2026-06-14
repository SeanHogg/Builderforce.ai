import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildNodeCapabilityProvider, NODE_FILE_SURFACE_CAPS } from "./node-capability-provider.js";

describe("buildNodeCapabilityProvider", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bf-node-cap-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("advertises the file-surface capabilities", () => {
    const provider = buildNodeCapabilityProvider({ workspaceRoot: root });
    expect(provider.capabilities).toBe(NODE_FILE_SURFACE_CAPS);
    expect([...provider.capabilities].toSorted()).toEqual([
      "repo.delete",
      "repo.edit",
      "repo.read",
      "repo.search",
      "repo.write",
    ]);
    expect(provider.repoRead).toBeDefined();
    expect(provider.repoWrite).toBeDefined();
  });

  it("writes a new file (created) then overwrites it (modified) on disk", async () => {
    const provider = buildNodeCapabilityProvider({ workspaceRoot: root });
    const created = await provider.repoWrite!.writeFile("src/feature.ts", "export const a = 1;\n");
    expect(created).toEqual({ ok: true, change: "created" });
    expect(await readFile(join(root, "src/feature.ts"), "utf-8")).toBe("export const a = 1;\n");

    const modified = await provider.repoWrite!.writeFile("src/feature.ts", "export const a = 2;\n");
    expect(modified).toEqual({ ok: true, change: "modified" });
  });

  it("reads a file and lists the tree (ignoring node_modules/.git)", async () => {
    const provider = buildNodeCapabilityProvider({ workspaceRoot: root });
    await provider.repoWrite!.writeFile("a.ts", "alpha");
    await provider.repoWrite!.writeFile("sub/b.ts", "beta");
    await writeFile(join(root, "ignored.txt"), "x");
    await provider.repoWrite!.writeFile("node_modules/dep/index.js", "skip");

    const read = await provider.repoRead!.readFile("sub/b.ts");
    expect(read).toEqual({ ok: true, path: "sub/b.ts", content: "beta" });

    const list = await provider.repoRead!.listFiles();
    expect(list.ok).toBe(true);
    expect(list.paths).toContain("a.ts");
    expect(list.paths).toContain("sub/b.ts");
    expect(list.paths).toContain("ignored.txt");
    expect(list.paths?.some((p) => p.includes("node_modules"))).toBe(false);
  });

  it("edits with an exact unique match; rejects a non-unique edit unless replaceAll", async () => {
    const provider = buildNodeCapabilityProvider({ workspaceRoot: root });
    await provider.repoWrite!.writeFile("f.ts", "const x = 1;\nconst y = 1;\n");

    const nonUnique = await provider.repoWrite!.editFile("f.ts", "= 1;", "= 9;", false);
    expect(nonUnique.ok).toBe(false);
    expect(nonUnique.error).toMatch(/not unique/);

    const all = await provider.repoWrite!.editFile("f.ts", "= 1;", "= 9;", true);
    expect(all).toMatchObject({ ok: true, change: "modified", replaced: 2 });
    expect(await readFile(join(root, "f.ts"), "utf-8")).toBe("const x = 9;\nconst y = 9;\n");

    const missing = await provider.repoWrite!.editFile("f.ts", "nope", "x", false);
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/not found/);
  });

  it("deletes a file; a missing file is a benign no-op", async () => {
    const provider = buildNodeCapabilityProvider({ workspaceRoot: root });
    await provider.repoWrite!.writeFile("gone.ts", "bye");

    const del = await provider.repoWrite!.deleteFile("gone.ts");
    expect(del).toEqual({ ok: true, deleted: true });

    const again = await provider.repoWrite!.deleteFile("gone.ts");
    expect(again.ok).toBe(true);
    expect(again.deleted).toBe(false);
  });

  it("rejects path traversal outside the workspace root", async () => {
    const provider = buildNodeCapabilityProvider({ workspaceRoot: root });
    const w = await provider.repoWrite!.writeFile("../escape.ts", "nope");
    expect(w.ok).toBe(false);
    expect(w.error).toMatch(/outside the workspace/);

    const r = await provider.repoRead!.readFile("../../etc/passwd");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/outside the workspace/);
  });
});
