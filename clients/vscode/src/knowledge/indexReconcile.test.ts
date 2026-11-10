import { describe, expect, it } from "vitest";
import { createFsDirectorySource, memoryHashCache, planKnowledgeReviewDetail, type KnowledgeFs } from "@builderforce/agent-tools/knowledge";
import { InMemoryIngestManifest } from "@seanhogg/builderforce-memory/ingest";
import { listingFilter, planIndex } from "./indexReconcile";

/** A synthetic tree on an in-memory fs that counts every file read. mtimes sit far in the past: nothing is racy. */
function syntheticTree(count: number) {
  const files = new Map<string, { text: string; mtimeNs: bigint; id: bigint }>();
  for (let i = 0; i < count; i++) files.set(`/w/src/d${i % 40}/f${i}.ts`, { text: `export const v${i} = ${i};\n`, mtimeNs: BigInt(1_000_000_000), id: BigInt(i + 1) });
  const reads: string[] = [];
  const fs: KnowledgeFs = {
    async readDirectory(path) {
      const prefix = `${path}/`;
      const out = new Map<string, "file" | "dir">();
      for (const p of files.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const slash = rest.indexOf("/");
        out.set(slash < 0 ? rest : rest.slice(0, slash), slash < 0 ? "file" : "dir");
      }
      return [...out];
    },
    async stat(path) {
      const f = files.get(path);
      if (!f) throw new Error(`ENOENT ${path}`);
      return { mtime: Number(f.mtimeNs / BigInt(1_000_000)), size: f.text.length, mtimeNs: f.mtimeNs, fileId: f.id };
    },
    async readFile(path) {
      const f = files.get(path);
      if (!f) throw new Error(`ENOENT ${path}`);
      reads.push(path);
      return new TextEncoder().encode(f.text);
    },
  };
  return { files, reads, fs };
}

describe("the reconciling plan (PRD 41 B2, done-check: a warm plan reuses the manifest)", () => {
  it("re-hashes nothing on a warm plan, and only the edited file after one edit", async () => {
    const tree = syntheticTree(4_000);
    const hashCache = memoryHashCache();
    const manifest = new InMemoryIngestManifest();
    // The review's plan, as `reviewPortsFor` makes it (a source per review, the folder's stat manifest shared).
    const ports = () => () => planKnowledgeReviewDetail(
      { source: createFsDirectorySource({ fs: tree.fs, rootPath: "/w", rootId: "r", title: "w", hashCache }), store: {} as never, manifest },
      { compare: false },
    );

    const cold = await planIndex(ports());
    expect(cold.files).toBe(4_000);
    expect(tree.reads.length).toBe(4_000);
    expect(cold.detail.merkle?.root).toBeTruthy();

    tree.reads.length = 0;
    const warm = await planIndex(ports());
    expect(tree.reads).toEqual([]);
    expect(warm.detail.plan.merkleRoot).toBe(cold.detail.plan.merkleRoot);

    const edited = "/w/src/d7/f7.ts";
    tree.files.set(edited, { text: "export const v7 = 'changed';\n", mtimeNs: BigInt(2_000_000_000), id: BigInt(8) });
    tree.reads.length = 0;
    const after = await planIndex(ports());
    expect(tree.reads).toEqual([edited]);
    expect(after.detail.plan.merkleRoot).not.toBe(cold.detail.plan.merkleRoot);
  });
});

describe("would the plan list a file the manifest does not know?", () => {
  const lists = listingFilter({
    ignoreTexts: [{ text: "dist/\n*.log\n", base: "" }, { text: "generated/\n", base: "pkg" }],
    skippedFolders: ["vendor/clone"],
  });

  it("not when an ignore file drops it, scoped to that file's folder", () => {
    expect(lists("dist/main.js")).toBe(false);
    expect(lists("tmp/run.log")).toBe(false);
    expect(lists("pkg/generated/x.ts")).toBe(false);
    expect(lists("generated/x.ts")).toBe(true);
  });

  it("not under a folder the walk skipped (a nested checkout)", () => {
    expect(lists("vendor/clone/src/a.ts")).toBe(false);
    expect(lists("vendor/other.ts")).toBe(true);
  });

  it("always for an ignore file itself (it changes what the plan lists) and an ordinary source", () => {
    expect(lists(".gitignore")).toBe(true);
    expect(lists(".builderforce/ignore")).toBe(true);
    expect(lists("src/new.ts")).toBe(true);
  });
});
