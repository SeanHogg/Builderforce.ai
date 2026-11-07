import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", async () => (await import("./vscodeL10nMock")).vscodeL10nMock);

import { excludeFromReview, ignorablePath, withIgnoredFolder, type IgnoreFilePort } from "./knowledgeExclude";

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
});

describe("ignorablePath", () => {
  it("normalizes and refuses anything that is not a plain folder path", () => {
    expect(ignorablePath("./a\\b/")).toBe("a/b");
    for (const bad of ["", ".", "../x", "a/../b", "#c", "!d", "a\nb", "/"]) expect(ignorablePath(bad)).toBeUndefined();
  });
});

describe("excludeFromReview", () => {
  const idle = (): boolean => false;

  it("writes the ignore file once, and not again for the same folder", async () => {
    const f = file("node_modules\n");
    await excludeFromReview({ rootId: "r", path: "bf-membump", file: f, isReviewing: idle });
    await excludeFromReview({ rootId: "r", path: "bf-membump/", file: f, isReviewing: idle });
    expect(f.text).toBe("node_modules\nbf-membump/\n");
    expect(f.writes).toBe(1);
  });

  it("creates the file when there is none", async () => {
    const f = file();
    await excludeFromReview({ rootId: "r", path: "copy", file: f, isReviewing: idle });
    expect(f.text).toBe("copy/\n");
  });

  it("refuses while a review of the root is running, writing nothing", async () => {
    const f = file("a\n");
    await expect(excludeFromReview({ rootId: "r", path: "x", file: f, isReviewing: (id) => id === "r" })).rejects.toThrow("already running");
    expect(f.writes).toBe(0);
  });

  it("refuses a path outside the root", async () => {
    const f = file();
    await expect(excludeFromReview({ rootId: "r", path: "../other", file: f, isReviewing: idle })).rejects.toThrow("cannot be excluded");
    expect(f.writes).toBe(0);
  });
});
