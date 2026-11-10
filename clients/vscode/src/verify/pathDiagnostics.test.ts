/** The fast tier: a clean language-server read is a PASS record, so a clean file is never "not verified". */
import { describe, expect, it } from "vitest";
import { pathDiagnostics, type VscodeLike } from "./pathDiagnostics";

const cleanEditor = (languageId = "typescript"): VscodeLike => ({
  workspace: {
    openTextDocument: async (uri) => {
      const fsPath = (uri as { fsPath: string }).fsPath;
      return { uri: { fsPath, toString: () => fsPath }, languageId };
    },
  },
  languages: {
    getDiagnostics: () => [],
    onDidChangeDiagnostics: (listener) => {
      const timer = setTimeout(() => listener({ uris: ["/ws/src/a.ts"] }), 0);
      return { dispose: () => clearTimeout(timer) };
    },
  },
  Uri: { file: (p: string) => ({ fsPath: p }) },
});

describe("pathDiagnostics", () => {
  it("regression: a clean code file yields a pass record with no findings", async () => {
    const record = await pathDiagnostics(["/ws/src/a.ts"], cleanEditor(), { root: "/ws" });
    expect(record).toMatchObject({ kind: "diagnostics", outcome: "pass", findings: [] });
  });

  it("yields no record when there is no code document to ask about", async () => {
    expect(await pathDiagnostics(["/ws/README.md"], cleanEditor("markdown"), { root: "/ws" })).toBeNull();
  });
});
