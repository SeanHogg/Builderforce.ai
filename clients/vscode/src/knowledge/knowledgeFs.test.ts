import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ ops: [] as string[] }));

// `vscode.workspace.fs` over the real disk, recording the operations the adapter uses.
vi.mock("vscode", async () => {
  const nodeFs = await import("node:fs/promises");
  const nodePath = await import("node:path");
  const uri = (fsPath: string) => ({ fsPath, path: fsPath });
  return {
    Uri: {
      file: uri,
      joinPath: (base: { fsPath: string }, ...parts: string[]) => uri(nodePath.join(base.fsPath, ...parts)),
    },
    workspace: {
      fs: {
        createDirectory: (u: { fsPath: string }) => nodeFs.mkdir(u.fsPath, { recursive: true }),
        readFile: (u: { fsPath: string }) => nodeFs.readFile(u.fsPath),
        writeFile: (u: { fsPath: string }, data: Uint8Array) => {
          calls.ops.push(`write:${nodePath.basename(u.fsPath)}`);
          return nodeFs.writeFile(u.fsPath, data);
        },
        rename: (a: { fsPath: string }, b: { fsPath: string }, o?: { overwrite?: boolean }) => {
          calls.ops.push(`rename:${nodePath.basename(a.fsPath)}>${nodePath.basename(b.fsPath)}:${o?.overwrite ? "overwrite" : "keep"}`);
          return nodeFs.rename(a.fsPath, b.fsPath);
        },
        delete: (u: { fsPath: string }) => nodeFs.rm(u.fsPath),
        readDirectory: async () => [],
      },
    },
  };
});

import { workspaceKnowledgeFiles } from "./knowledgeFs";

let folder: string;
const knowledgeDir = () => join(folder, ".builderforce", "knowledge");

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "bf-kfs-"));
  calls.ops.length = 0;
});

describe("workspaceKnowledgeFiles", () => {
  it("writes a file to a temp name and renames it over the target, never truncating in place", async () => {
    const files = workspaceKnowledgeFiles(folder);
    await files.write("a.json", "one");
    await files.write("a.json", "two");
    expect(await files.read("a.json")).toBe("two");
    expect(calls.ops).toEqual([
      "write:a.json.tmp", "rename:a.json.tmp>a.json:overwrite",
      "write:a.json.tmp", "rename:a.json.tmp>a.json:overwrite",
    ]);
    expect(await readdir(knowledgeDir())).toEqual(["a.json"]); // no temp file left
  });

  it("writes into a sub-folder, creating it", async () => {
    const files = workspaceKnowledgeFiles(folder);
    await files.write("runs/r1.json", "{}");
    expect(await readFile(join(knowledgeDir(), "runs", "r1.json"), "utf8")).toBe("{}");
  });

  it("serializes concurrent appends to one file: every batch lands whole, none interleaved", async () => {
    const files = workspaceKnowledgeFiles(folder);
    const batch = (c: string) => `${(c.repeat(200_000))}\n`;
    await Promise.all(["a", "b", "c", "d"].map((c) => files.append!("log.jsonl", batch(c))));
    const lines = (await readFile(join(knowledgeDir(), "log.jsonl"), "utf8")).split("\n").filter(Boolean);
    expect(lines.map((l) => new Set(l).size)).toEqual([1, 1, 1, 1]);
    expect(lines.map((l) => l.length)).toEqual([200_000, 200_000, 200_000, 200_000]);
  });

  it("appends accumulate in call order", async () => {
    const files = workspaceKnowledgeFiles(folder);
    await files.append!("x.jsonl", "a\n");
    await files.append!("x.jsonl", "b\n");
    expect(await files.read("x.jsonl")).toBe("a\nb\n");
  });
});
