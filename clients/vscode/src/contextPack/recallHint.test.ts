import { describe, expect, it } from "vitest";
import { isRelativePath } from "./focusPaths";
import { contextPackRecallHint } from "./renderContextPack";

// PRD 35 §6.10 recall query: the focus files' paths and headings, then the code paths
// those files name — never the bare sentence.

describe("contextPackRecallHint with the code paths the focus files name", () => {
  const focus = [{ path: "docs/specs/35.md", totalLines: 900, outline: [{ heading: "WS8", line: 300 }] }];

  it("appends the named paths after the focus part, deduped and without the focus files", () => {
    expect(contextPackRecallHint({ focus }, 6, ["clients/vscode/src/bfApi.ts", "docs/specs/35.md", "clients/vscode/src/bfApi.ts", "api/src/a.ts"]))
      .toBe("docs/specs/35.md WS8 clients/vscode/src/bfApi.ts api/src/a.ts");
  });

  it("is the focus part alone when nothing is named", () => {
    expect(contextPackRecallHint({ focus })).toBe("docs/specs/35.md WS8");
  });
});

describe("isRelativePath", () => {
  it("refuses a drive or rooted path — somebody else's machine", () => {
    expect(isRelativePath("clients/vscode/src/bfApi.ts")).toBe(true);
    expect(isRelativePath("C:/code/x.ts")).toBe(false);
    expect(isRelativePath("/home/x.ts")).toBe(false);
    expect(isRelativePath("\\\\server\\x.ts")).toBe(false);
  });
});
