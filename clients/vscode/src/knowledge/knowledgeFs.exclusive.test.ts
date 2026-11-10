/** The knowledge files' exclusive create and takeover rename — what makes the replica lock race-free across windows. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", async () => {
  const nodePath = await import("node:path");
  const uri = (fsPath: string) => ({ fsPath, path: fsPath });
  return {
    Uri: { file: uri, joinPath: (base: { fsPath: string }, ...parts: string[]) => uri(nodePath.join(base.fsPath, ...parts)) },
    workspace: { fs: {} },
  };
});

import { createExclusiveFile, workspaceKnowledgeFiles } from "./knowledgeFs";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kfs-excl-"));
  dirs.push(dir);
  return dir;
}

describe("createExclusiveFile", () => {
  it("regression: of concurrent creates of one file exactly one wins, and the file holds the winner's text", async () => {
    const path = join(await temp(), "nested", "a.lock");
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => createExclusiveFile(path, `owner-${i}`)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await readFile(path, "utf8")).toBe(`owner-${results.indexOf(true)}`);
  });

  it("answers false (never throws) when the file already exists, and leaves it untouched", async () => {
    const path = join(await temp(), "b.lock");
    await writeFile(path, "held");
    expect(await createExclusiveFile(path, "mine")).toBe(false);
    expect(await readFile(path, "utf8")).toBe("held");
  });
});

describe("workspaceKnowledgeFiles: the lock ports", () => {
  it("exposes createExclusive under .builderforce/knowledge/, two concurrent calls yield one winner", async () => {
    const root = await temp();
    const files = workspaceKnowledgeFiles(root);
    const [a, b] = await Promise.all([files.createExclusive!("r.lock", "A"), files.createExclusive!("r.lock", "B")]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await readFile(join(root, ".builderforce", "knowledge", "r.lock"), "utf8")).toBe(a ? "A" : "B");
  });

  it("rename rejects once the source has been moved aside (a takeover that lost)", async () => {
    const root = await temp();
    const files = workspaceKnowledgeFiles(root);
    expect(await files.createExclusive!("r.lock", "stale")).toBe(true);
    await files.rename!("r.lock", "r.lock.1.taken");
    await expect(files.rename!("r.lock", "r.lock.2.taken")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("regression: two hosts taking over one stale lock at once end with exactly one holder", async () => {
    // Windows may let two truly simultaneous renames of one file both succeed; the takeover stays
    // safe because the create that follows is exclusive — only one of the racers gets the name.
    const root = await temp();
    const files = workspaceKnowledgeFiles(root);
    expect(await files.createExclusive!("r.lock", "stale")).toBe(true);
    const takeover = async (who: string): Promise<boolean> => {
      await files.rename!("r.lock", `r.lock.${who}.taken`).catch(() => undefined);
      return files.createExclusive!("r.lock", who);
    };
    const won = await Promise.all([takeover("A"), takeover("B")]);
    expect(won.filter(Boolean)).toHaveLength(1);
    expect(await readFile(join(root, ".builderforce", "knowledge", "r.lock"), "utf8")).toBe(won[0] ? "A" : "B");
  });
});
