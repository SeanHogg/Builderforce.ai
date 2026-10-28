import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

import { MAX_INLINE_TEXT_BYTES } from "@seanhogg/builderforce-brain-embedded";
import { mentionBudget } from "@builderforce/tool-output-policy";
import { readChatReferences, referencesTurnBlock, type ReferenceReader } from "./chatReferences";
import { INGRESS_COMPRESS_MIN_CHARS } from "./contextIngress";

/** A `Uri`-shaped value (the reader only duck-types `scheme` + `path`). */
const uri = (path: string) => ({ scheme: "file", path, fsPath: path }) as never;
const range = (start: number, end: number) => ({ start: { line: start, character: 0 }, end: { line: end, character: 4 } }) as never;

function reader(files: Record<string, string | null>): ReferenceReader & { ranges: unknown[] } {
  const ranges: unknown[] = [];
  return {
    ranges,
    readFile: async (u) => files[(u as unknown as { path: string }).path] ?? null,
    readRange: async (u, r) => {
      ranges.push(r);
      const text = files[(u as unknown as { path: string }).path];
      return text == null ? null : text.split("\n").slice(r.start.line, r.end.line + 1).join("\n");
    },
    relativePath: (u) => (u as unknown as { path: string }).path.replace(/^\/ws\//, ""),
  };
}

describe("readChatReferences", () => {
  it("reads a #file Uri as the whole file, named by its relative path", async () => {
    const out = await readChatReferences([{ id: "vscode.file", value: uri("/ws/src/a.ts") }], reader({ "/ws/src/a.ts": "export const a = 1;" }));
    expect(out).toEqual([{ name: "src/a.ts", text: "export const a = 1;" }]);
  });

  it("reads a Location as its range, named path:start-end (1-based)", async () => {
    const r = reader({ "/ws/src/b.ts": "l1\nl2\nl3\nl4" });
    const out = await readChatReferences([{ id: "vscode.selection", value: { uri: uri("/ws/src/b.ts"), range: range(1, 2) } }], r);
    expect(out).toEqual([{ name: "src/b.ts:2-3", text: "l2\nl3" }]);
    expect(r.ranges).toHaveLength(1);
  });

  it("keeps a string value under the reference's name", async () => {
    const out = await readChatReferences([{ id: "my.var", name: "terminal output", value: "npm ERR! missing script" }], reader({}));
    expect(out).toEqual([{ name: "terminal output", text: "npm ERR! missing script" }]);
  });

  it("leaves out a directory, a binary or an unreadable file, and unknown values", async () => {
    const out = await readChatReferences(
      [
        { id: "dir", value: uri("/ws/src") },
        { id: "gone", value: uri("/ws/missing.ts") },
        { id: "odd", value: 42 },
        { id: "ok", value: uri("/ws/README.md") },
      ],
      reader({ "/ws/src": null, "/ws/README.md": "# Readme" }),
    );
    expect(out).toEqual([{ name: "README.md", text: "# Readme" }]);
  });

  it("survives a reader that throws", async () => {
    const throwing: ReferenceReader = {
      readFile: async () => { throw new Error("EACCES"); },
      readRange: async () => { throw new Error("EACCES"); },
      relativePath: () => "x",
    };
    expect(await readChatReferences([{ id: "f", value: uri("/ws/x") }], throwing)).toEqual([]);
  });
});

describe("readChatReferences — size cap", () => {
  it("leaves out a range, a file or a string over the inline cap", async () => {
    const huge = "x".repeat(MAX_INLINE_TEXT_BYTES + 1);
    const out = await readChatReferences(
      [
        { id: "range", value: { uri: uri("/ws/big.log"), range: range(0, 0) } },
        { id: "file", value: uri("/ws/big.log") },
        { id: "var", name: "dump", value: huge },
        { id: "ok", value: uri("/ws/ok.md") },
      ],
      reader({ "/ws/big.log": huge, "/ws/ok.md": "fine" }),
    );
    expect(out).toEqual([{ name: "ok.md", text: "fine" }]);
  });
});

describe("referencesTurnBlock — lazy, cancellable", () => {
  const prose = "The release notes describe the change. ".repeat(Math.ceil(INGRESS_COMPRESS_MIN_CHARS / 39) + 5);
  const refs = [{ id: "sel", value: { uri: uri("/ws/notes.md"), range: range(0, 0) } }];
  function setup(answer?: () => Promise<string | undefined>, cancelled: () => boolean = () => false) {
    const compress = vi.fn(async (text: string, _kind: string) => ({ text: text.slice(0, 100), compressed: true, originalTokens: 10, keptTokens: 5 }));
    const budget = vi.fn(async () => mentionBudget("cloud"));
    const r = reader({ "/ws/notes.md": prose });
    const read = vi.spyOn(r, "readRange");
    const run = () => referencesTurnBlock(refs, { reader: r, budget, deps: { compress }, cancelled, ...(answer ? { deterministicAnswer: answer } : {}) });
    return { compress, budget, read, run };
  }

  it("compresses a range of a prose file as prose — the range suffix does not make it code", async () => {
    const t = setup();
    const out = await t.run();
    expect(t.compress).toHaveBeenCalledTimes(1);
    expect(t.compress.mock.calls[0]![1]).toBe("markdown");
    expect(out).toContain("Attached file: notes.md:1-1 (compressed for reading");
  });

  it("reads nothing for a turn answered without a model", async () => {
    const t = setup(async () => "`foo` is defined in src/a.ts:3");
    expect(await t.run()).toBe("");
    expect(t.read).not.toHaveBeenCalled();
    expect(t.budget).not.toHaveBeenCalled();
  });

  it("reads them when the turn needs a model", async () => {
    expect(await setup(async () => undefined).run()).toContain("notes.md:1-1");
  });

  it("stops once the request is cancelled", async () => {
    let cancelled = false;
    const t = setup(async () => { cancelled = true; return undefined; }, () => cancelled);
    expect(await t.run()).toBe("");
    expect(t.read).not.toHaveBeenCalled();
    expect(t.compress).not.toHaveBeenCalled();
  });
});
