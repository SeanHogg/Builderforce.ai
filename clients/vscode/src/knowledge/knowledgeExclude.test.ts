import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", async () => (await import("./vscodeL10nMock")).vscodeL10nMock);

import { excludeFromReview, ignorablePath, ignoreLiteral, withIgnoredFolder, type IgnoreFilePort } from "./knowledgeExclude";

function file(initial?: string): IgnoreFilePort & { text?: string; writes: number } {
  const f: IgnoreFilePort & { text?: string; writes: number } = {
    text: initial, writes: 0,
    async read() { return f.text; },
    async write(t) { f.text = t; f.writes++; },
  };
  return f;
}

describe("withIgnoredFolder", () => {
  it("appends the folder with a trailing slash, keeping the rest", () => {
    expect(withIgnoredFolder("dist\n", "bf-membump")).toBe("dist\nbf-membump/\n");
    expect(withIgnoredFolder("dist", "a/b")).toBe("dist\na/b/\n");
    expect(withIgnoredFolder(undefined, "x")).toBe("x/\n");
    expect(withIgnoredFolder("dist\r\n", "x")).toBe("dist\r\nx/\r\n");
  });

  it("does not add a folder twice", () => {
    expect(withIgnoredFolder("x/\n", "x")).toBe("x/\n");
    expect(withIgnoredFolder("/x/\n", "x")).toBe("/x/\n");
  });

  it("writes glob characters as literals, once", () => {
    expect(ignoreLiteral("a*b?[c]{d}\\e")).toBe("a\\*b\\?\\[c\\]\\{d\\}\\\\e");
    const once = withIgnoredFolder("", "copy*");
    expect(once).toBe("copy\\*/\n");
    expect(withIgnoredFolder(once, "copy*")).toBe(once);
  });
});

describe("ignorablePath", () => {
  it("normalizes and refuses anything that is not a plain folder path", () => {
    expect(ignorablePath("./a\\b/")).toBe("a/b");
    for (const bad of ["", ".", "../x", "a/../b", "#c", "!d", "a\nb", "/"]) expect(ignorablePath(bad)).toBeUndefined();
  });

  it("refuses absolute, drive-lettered and whitespace-padded paths", () => {
    for (const bad of ["/abs/x", "\\abs\\x", "C:/x", "c:\\x", "C:x", " x", "x ", "x\t"]) expect(ignorablePath(bad)).toBeUndefined();
  });
});

describe("excludeFromReview", () => {
  const idle = (): boolean => false;
  const copiesOf = (...paths: string[]) => async (): Promise<readonly string[]> => paths;
  const holds = () => {
    const state = { held: 0 };
    return { state, hold: async <T>(run: () => Promise<T>): Promise<T> => { state.held++; try { return await run(); } finally { state.held--; } } };
  };

  it("writes the ignore file once, inside the hold, and not again for the same folder", async () => {
    const f = file("node_modules\n");
    const h = holds();
    const seen: number[] = [];
    const watched: IgnoreFilePort = { read: () => { seen.push(h.state.held); return f.read(); }, write: (t) => { seen.push(h.state.held); return f.write(t); } };
    await excludeFromReview({ rootId: "r", path: "bf-membump", file: watched, isReviewing: idle, copies: copiesOf("bf-membump"), hold: h.hold });
    await excludeFromReview({ rootId: "r", path: "bf-membump/", file: watched, isReviewing: idle, copies: copiesOf("bf-membump"), hold: h.hold });
    expect(f.text).toBe("node_modules\nbf-membump/\n");
    expect(f.writes).toBe(1);
    expect(seen.every((n) => n === 1)).toBe(true);
  });

  it("creates the file when there is none", async () => {
    const f = file();
    await excludeFromReview({ rootId: "r", path: "copy", file: f, isReviewing: idle, copies: copiesOf("copy"), hold: holds().hold });
    expect(f.text).toBe("copy/\n");
  });

  it("refuses while a review of the root is running, writing nothing", async () => {
    const f = file("a\n");
    await expect(excludeFromReview({ rootId: "r", path: "x", file: f, isReviewing: (id) => id === "r", copies: copiesOf("x"), hold: holds().hold })).rejects.toThrow("already running");
    expect(f.writes).toBe(0);
  });

  it("refuses a path outside the root", async () => {
    const f = file();
    await expect(excludeFromReview({ rootId: "r", path: "../other", file: f, isReviewing: idle, copies: copiesOf("../other"), hold: holds().hold })).rejects.toThrow("cannot be excluded");
    expect(f.writes).toBe(0);
  });

  it("refuses a folder the last review did not record as a copy, writing nothing", async () => {
    const f = file("a\n");
    await expect(excludeFromReview({ rootId: "r", path: "src", file: f, isReviewing: idle, copies: copiesOf("bf-membump"), hold: holds().hold })).rejects.toThrow("cannot be excluded");
    expect(f.writes).toBe(0);
  });
});
