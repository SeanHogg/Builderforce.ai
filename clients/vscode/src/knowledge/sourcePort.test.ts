import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const editor = vi.hoisted(() => ({ shown: [] as { path: string; options: unknown }[] }));

vi.mock("vscode", () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  workspace: { fs: { readFile: async (uri: { fsPath: string }) => new Uint8Array(await readFile(uri.fsPath)) } },
  window: {
    showTextDocument: async (uri: { fsPath: string }, options: unknown) => { editor.shown.push({ path: uri.fsPath, options }); },
  },
  Range: class {
    constructor(readonly startLine: number, readonly startCharacter: number, readonly endLine: number, readonly endCharacter: number) {}
  },
}));

import { MAX_SOURCE_LINES } from "./knowledgeProtocol";
import { slash, type KnowledgeRoot } from "./knowledgeRoots";
import { clampLines, MAX_SOURCE_FILE_BYTES, openSource, readSource } from "./sourcePort";

let base: string;
let root: KnowledgeRoot;

const numbered = (n: number): string => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "bf-source-port-"));
  const rootDir = join(base, "root");
  await mkdir(join(rootDir, "src"), { recursive: true });
  await writeFile(join(rootDir, "src", "a.ts"), numbered(10));
  await mkdir(join(base, "outside"));
  await writeFile(join(base, "outside", "secret.ts"), "secret");
  root = { rootId: "r", title: "root", rootPath: slash(rootDir), folderPath: slash(rootDir), rel: "" };
  editor.shown = [];
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("sourcePort.readSource", () => {
  it("reads the asked lines of a file inside the root", async () => {
    expect(await readSource(root, "src/a.ts", 3, 5)).toEqual({ startLine: 3, lines: ["line 3", "line 4", "line 5"], truncated: false });
  });

  it("refuses a `..` escape, an absolute path and a NUL, and answers null for a missing file", async () => {
    expect(await readSource(root, "../outside/secret.ts", 1, 1)).toBeNull();
    expect(await readSource(root, "src/../../outside/secret.ts", 1, 1)).toBeNull();
    expect(await readSource(root, join(base, "outside", "secret.ts"), 1, 1)).toBeNull();
    expect(await readSource(root, "/etc/passwd", 1, 1)).toBeNull();
    expect(await readSource(root, "src/a.ts\0", 1, 1)).toBeNull();
    expect(await readSource(root, 42, 1, 1)).toBeNull();
    expect(await readSource(root, "src/gone.ts", 1, 1)).toBeNull();
  });

  it("refuses a link inside the root that leads outside it", async () => {
    // A junction needs no privilege on Windows; elsewhere it is an ordinary directory symlink.
    await symlink(join(base, "outside"), join(base, "root", "link"), "junction");
    expect(await readSource(root, "link/secret.ts", 1, 1)).toBeNull();
  });

  it("does not read a file over the size cap", async () => {
    await writeFile(join(base, "root", "big.ts"), "x".repeat(MAX_SOURCE_FILE_BYTES + 1));
    expect(await readSource(root, "big.ts", 1, 1)).toBeNull();
  });

  it("clamps the lines: from 1, at most MAX_SOURCE_LINES, truncated when the cap cut the range", async () => {
    await writeFile(join(base, "root", "long.ts"), numbered(MAX_SOURCE_LINES * 2));
    const text = await readSource(root, "long.ts", -5, MAX_SOURCE_LINES * 2);
    expect(text?.startLine).toBe(1);
    expect(text?.lines).toHaveLength(MAX_SOURCE_LINES);
    expect(text?.truncated).toBe(true);
    expect(clampLines(Number.NaN, "x")).toEqual({ startLine: 1, endLine: 1, truncated: false });
    expect(clampLines(7, 3)).toEqual({ startLine: 7, endLine: 7, truncated: false });
  });
});

describe("sourcePort.openSource", () => {
  it("opens a file inside the root with the lines selected (0-based), as a preview", async () => {
    await openSource(root, "src/a.ts", 3, 5);
    expect(editor.shown).toHaveLength(1);
    expect(editor.shown[0]!.options).toEqual({ selection: { startLine: 2, startCharacter: 0, endLine: 4, endCharacter: 0 }, preview: true });
  });

  it("selects the start line alone without an end, and opens nothing outside the root", async () => {
    await openSource(root, "src/a.ts", 4);
    expect(editor.shown[0]!.options).toMatchObject({ selection: { startLine: 3, endLine: 3 } });
    await openSource(root, "../outside/secret.ts", 1);
    expect(editor.shown).toHaveLength(1);
  });
});
