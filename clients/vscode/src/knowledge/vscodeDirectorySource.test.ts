import { describe, expect, it } from "vitest";
import { sha256Hex } from "@seanhogg/builderforce-memory/knowledge";
import { createDirectorySource, type KnowledgeFs } from "./vscodeDirectorySource";

const enc = new TextEncoder();

/** An in-memory tree under /ws: path → content, with mtimes and a read counter. */
function fakeFs(files: Record<string, string>) {
  const state = { reads: 0, mtime: 1, files: { ...files } };
  let watcher: ((paths: string[]) => void) | undefined;
  const fs: KnowledgeFs = {
    async readDirectory(dir) {
      const prefix = `${dir}/`;
      const out = new Map<string, "file" | "dir">();
      for (const p of Object.keys(state.files)) {
        if (!p.startsWith(prefix)) continue;
        const [head, ...rest] = p.slice(prefix.length).split("/");
        out.set(head!, rest.length > 0 ? "dir" : "file");
      }
      return [...out];
    },
    async stat(path) {
      return { mtime: state.mtime, size: enc.encode(state.files[path] ?? "").length };
    },
    async readFile(path) {
      state.reads += 1;
      return enc.encode(state.files[path] ?? "");
    },
    watch(_base, cb) {
      watcher = cb;
      return () => { watcher = undefined; };
    },
  };
  return { fs, state, emit: (paths: string[]) => watcher?.(paths) };
}

async function listAll(source: ReturnType<typeof createDirectorySource>) {
  const out: Array<{ path: string; hash: string; size: number }> = [];
  for await (const e of source.list()) out.push(e);
  return out;
}

describe("the editor's DirectorySource", () => {
  const tree = {
    "/ws/README.md": "# Hi",
    "/ws/src/a.ts": "export const a = 1;",
    "/ws/node_modules/x/index.js": "nope",
    "/ws/.git/HEAD": "ref",
    "/ws/.builderforce/ignore": "dist/",
    "/ws/.builderforce/knowledge/snap.json": "{}",
    "/ws/.builderforce/symbols.json": "{}",
  };

  it("lists files with their SHA-256, skipping install, VCS and our own state", async () => {
    const { fs } = fakeFs(tree);
    const listed = await listAll(createDirectorySource({ fs, rootPath: "/ws", rootId: "ws", title: "ws" }));
    expect(listed.map((e) => e.path).sort()).toEqual([".builderforce/ignore", "README.md", "src/a.ts"]);
    expect(listed.find((e) => e.path === "README.md")?.hash).toBe(sha256Hex(enc.encode("# Hi")));
  });

  it("re-hashes only files whose mtime or size changed", async () => {
    const { fs, state } = fakeFs(tree);
    const cache = new Map();
    const source = createDirectorySource({ fs, rootPath: "/ws", rootId: "ws", title: "ws", hashCache: cache });
    await listAll(source);
    const first = state.reads;
    expect(first).toBe(3);
    await listAll(source);
    expect(state.reads).toBe(first);
    state.mtime = 2;
    await listAll(source);
    expect(state.reads).toBe(first * 2);
  });

  it("reads a file as a text document named by its root-relative path", async () => {
    const { fs } = fakeFs(tree);
    const doc = await createDirectorySource({ fs, rootPath: "/ws", rootId: "ws", title: "ws" }).read("src/a.ts");
    expect(doc).toMatchObject({ id: "src/a.ts", content: { kind: "text", text: "export const a = 1;" } });
  });

  it("reviews a sub-folder with paths relative to it, and watches only what it lists", async () => {
    const { fs, emit } = fakeFs(tree);
    const source = createDirectorySource({ fs, rootPath: "/ws/src", rootId: "ws/src", title: "src" });
    expect((await listAll(source)).map((e) => e.path)).toEqual(["a.ts"]);
    const seen: string[][] = [];
    const stop = source.watch!((paths) => seen.push(paths));
    emit(["/ws/src/a.ts", "/ws/src/node_modules/y.js", "/ws/README.md"]);
    stop();
    expect(seen).toEqual([["a.ts"]]);
  });
});
