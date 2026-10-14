import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDesktopFetchForTests } from "@builderforce/agent-tools/node-desktop.js";
import {
  buildNodeCapabilityProvider,
  catalogNodeCapabilityProvider,
  NODE_FILE_SURFACE_CAPS,
  NODE_SURFACE_CAPS,
} from "./node-capability-provider.js";

describe("buildNodeCapabilityProvider", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bf-node-cap-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("advertises the file + human capabilities", () => {
    const provider = buildNodeCapabilityProvider({ workspaceRoot: root });
    expect(provider.capabilities).toBe(NODE_SURFACE_CAPS);
    expect([...provider.capabilities].toSorted()).toEqual([
      "human",
      "repo.delete",
      "repo.edit",
      "repo.read",
      "repo.search",
      "repo.symbols",
      "repo.write",
    ]);
    // The file-only subset is still exported (and is a strict subset of the full set).
    for (const cap of NODE_FILE_SURFACE_CAPS) expect(provider.capabilities.has(cap)).toBe(true);
    expect(provider.repoRead).toBeDefined();
    expect(provider.repoWrite).toBeDefined();
    expect(provider.human).toBeDefined();
  });

  it("backs the human capability inline (paused:false), returning the human's answer", async () => {
    const seen: Array<{ kind?: string; description: string }> = [];
    const provider = buildNodeCapabilityProvider({
      workspaceRoot: root,
      requestHuman: async (req) => {
        seen.push({ kind: req.kind, description: req.description });
        return { decision: "answered", responseText: "use XLSX" };
      },
    });
    const r = await provider.human!.ask("CSV or XLSX?", "the spec is ambiguous");
    expect(r.paused).toBe(false);
    expect(r.answer).toBe("use XLSX");
    // question + context are folded into the description the human sees.
    expect(seen[0].kind).toBe("question");
    expect(seen[0].description).toContain("CSV or XLSX?");
    expect(seen[0].description).toContain("the spec is ambiguous");
  });

  it("maps a human timeout to a no-answer note (never a fabricated approval)", async () => {
    const provider = buildNodeCapabilityProvider({
      workspaceRoot: root,
      requestHuman: async () => ({ decision: "timeout" }),
    });
    const r = await provider.human!.ask("proceed?");
    expect(r.paused).toBe(false);
    expect(r.answer).toBeNull();
    expect(r.note).toMatch(/No human responded/);
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

  it("unconfined scope lets readFile and writeFile reach the same out-of-tree path", async () => {
    // write_file probes the target through readFile before writing. If read is confined
    // tighter than write, the probe reports "outside the workspace" and the guard
    // refuses every legitimate unconfined write.
    const outside = await mkdtemp(join(tmpdir(), "bf-node-cap-out-"));
    try {
      const provider = buildNodeCapabilityProvider({ workspaceRoot: root, scope: "unconfined" });
      const target = join(outside, "note.txt");
      const w = await provider.repoWrite!.writeFile(target, "hello\n");
      expect(w).toEqual({ ok: true, change: "created" });
      const r = await provider.repoRead!.readFile(target);
      expect(r).toEqual({ ok: true, path: target, content: "hello\n" });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

function fakeDesktop(routes: Record<string, (body: Record<string, unknown>) => unknown> = {}) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const op = url.split("/v1/")[1] ?? "";
    if ((init?.headers as Record<string, string>)?.Authorization !== "Bearer tok") {
      return new Response("{}", { status: 401 });
    }
    if (op === "health") return new Response(JSON.stringify({ version: "x" }), { status: 200 });
    const handler = routes[op];
    if (!handler) return new Response(JSON.stringify({ error: `unknown '${op}'` }), { status: 400 });
    return new Response(JSON.stringify(handler(JSON.parse(String(init?.body ?? "{}")))), { status: 200 });
  };
}

describe("catalogNodeCapabilityProvider — repo.semantic probe", () => {
  let root: string;
  let dir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bf-node-cap-sem-"));
    dir = fs.mkdtempSync(join(tmpdir(), "bf-desktop-"));
    process.env.BUILDERFORCE_DESKTOP_DISCOVERY = join(dir, "desktop.json");
  });
  afterEach(async () => {
    setDesktopFetchForTests(null);
    delete process.env.BUILDERFORCE_DESKTOP_DISCOVERY;
    fs.rmSync(dir, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  it("does not advertise repo.semantic when the desktop probe is absent", async () => {
    setDesktopFetchForTests(fakeDesktop());
    const provider = await catalogNodeCapabilityProvider({ workspaceRoot: root });
    expect(provider.capabilities.has("repo.semantic")).toBe(false);
    expect(provider.semantic).toBeUndefined();
  });

  it("advertises repo.semantic and backs it when the desktop probe succeeds", async () => {
    fs.writeFileSync(
      process.env.BUILDERFORCE_DESKTOP_DISCOVERY!,
      JSON.stringify({ port: 4999, token: "tok", pid: 1, version: "x" }),
    );
    setDesktopFetchForTests(
      fakeDesktop({
        search: () => ({ results: [], status: { phase: { state: "ready" }, files: 0 } }),
      }),
    );
    const provider = await catalogNodeCapabilityProvider({ workspaceRoot: root });
    expect(provider.capabilities.has("repo.semantic")).toBe(true);
    expect(provider.semantic).toBeDefined();
    const r = await provider.semantic!.search("x");
    expect(r.ok).toBe(true);
  });

  it("does not advertise repo.semantic on the sync builder (not always-on)", () => {
    const provider = buildNodeCapabilityProvider({ workspaceRoot: root });
    expect(provider.capabilities.has("repo.semantic")).toBe(false);
    expect(provider.capabilities).toBe(NODE_SURFACE_CAPS);
    expect(provider.semantic).toBeUndefined();
  });
});
