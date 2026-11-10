/**
 * The editor's ship-gate ports (PRD 46 §3.6, F3): what a run is handed beside `needsConfirm`.
 * Fakes stand in for the editor, git and the disk; the composition under test is the real one.
 */
import * as path from "path";
import { describe, expect, it } from "vitest";
import type { BrainStreamFn } from "@seanhogg/builderforce-brain-embedded";
import { createShipPorts, parseReviewReply } from "./shipPorts";
import type { VscodeLike } from "./pathDiagnostics";
import type { GitRunner } from "./gitPort";

const ROOT = path.resolve("/ws");

/** A fake editor whose language server reports one error for every opened TypeScript file. */
function fakeVscode(opened: string[]): VscodeLike {
  return {
    workspace: {
      openTextDocument: async (uri) => {
        const fsPath = (uri as { fsPath: string }).fsPath;
        opened.push(fsPath);
        return { uri: { fsPath, toString: () => fsPath }, languageId: "typescript" };
      },
      workspaceFolders: [{ uri: { fsPath: ROOT } }],
    },
    languages: {
      getDiagnostics: () => [{ severity: 0, message: "Declaration or statement expected.", code: 1128, source: "ts", range: { start: { line: 11, character: 2 } } }],
      // The server answers on the next tick for everything opened so far (no 3 s wait).
      onDidChangeDiagnostics: (listener) => {
        const timer = setTimeout(() => listener({ uris: [...opened] }), 0);
        return { dispose: () => clearTimeout(timer) };
      },
    },
    Uri: { file: (p: string) => ({ fsPath: p }) },
  };
}

const noStream: BrainStreamFn = async () => ({ text: "", toolCalls: [], finishReason: "stop" });

describe("createShipPorts", () => {
  it("resolves a workspace-relative edit path against the root before asking the language server", async () => {
    const opened: string[] = [];
    const ports = createShipPorts({ vscode: fakeVscode(opened), git: async () => ({ stdout: "", exitCode: 0 }) })({ root: ROOT, stream: noStream });
    const record = await ports.verifier.diagnostics(["src/labels.ts"]);
    expect(opened).toEqual([path.join(ROOT, "src/labels.ts")]);
    expect(record?.outcome).toBe("fail");
    expect(record?.findings[0]).toContain("src/labels.ts:12:3");
  });

  it("builds the verifier and git port once per workspace root, the reviewer per run", () => {
    const make = createShipPorts({ vscode: fakeVscode([]), git: async () => ({ stdout: "", exitCode: 0 }) });
    const a = make({ root: ROOT, stream: noStream });
    const b = make({ root: ROOT, stream: noStream });
    expect(b.verifier).toBe(a.verifier);
    expect(b.git).toBe(a.git);
    expect(b.reviewer).not.toBe(a.reviewer);
  });

  it("runs git in the workspace root when the call named no repo, and marks a path absent from the base as new", async () => {
    const calls: { args: readonly string[]; cwd: string }[] = [];
    const git: GitRunner = async (args, { cwd }) => {
      calls.push({ args, cwd });
      if (args[0] === "rev-parse" && args.includes("@{u}")) return { stdout: "origin/main\n", exitCode: 0 };
      if (args[0] === "rev-parse") return { stdout: "main\n", exitCode: 0 };
      if (args[0] === "merge-base") return { stdout: "base1\n", exitCode: 0 };
      if (args[0] === "log") return { stdout: "c0ffee0c0ffee0c0ffee0c0ffee0c0ffee0c0ffe\nsrc/new.ts\nsrc/old.ts\n", exitCode: 0 };
      if (args[0] === "cat-file") return { stdout: "", exitCode: String(args[2]).endsWith("src/new.ts") ? 128 : 0 };
      return { stdout: "", exitCode: 0 };
    };
    const ports = createShipPorts({ vscode: fakeVscode([]), git, readText: async () => "export const x = 1;\n" })({ root: ROOT, stream: noStream });
    const { files, baseBranch } = await ports.git.outgoing("");
    expect(calls.every((c) => c.cwd === ROOT)).toBe(true);
    expect(baseBranch).toBe(true);
    expect(files.map((f) => [f.absPath.endsWith("src/new.ts") ? "new" : "old", f.isNew])).toEqual([["new", true], ["old", false]]);
  });

  it("reviews on the review stage pin, strictly, and reads the JSON verdict", async () => {
    const asked: { model?: string; modelStrict?: boolean; role?: string }[] = [];
    const stream: BrainStreamFn = async (opts) => {
      asked.push({ model: opts.model, modelStrict: opts.modelStrict, role: opts.role });
      return { text: '```json\n{"verdict":"approved","findings":[]}\n```', toolCalls: [], finishReason: "stop" };
    };
    const ports = createShipPorts({ vscode: fakeVscode([]), git: async () => ({ stdout: "", exitCode: 0 }) })({
      root: ROOT,
      stream,
      settings: { phaseModels: { verify: "reviewer-model", code: "author-model" } },
    });
    const verdict = await ports.reviewer.review({ repo: ROOT, diff: "diff", evidence: "", authorModels: ["author-model"] });
    expect(asked).toEqual([{ model: "reviewer-model", modelStrict: true, role: "verify" }]);
    expect(verdict).toMatchObject({ reviewerModel: "reviewer-model", verdict: "approved" });
  });
});

describe("parseReviewReply", () => {
  it("never reads a non-JSON reply as approval", () => {
    expect(parseReviewReply("Looks good to me!").verdict).toBe("changes_requested");
    expect(parseReviewReply('{"verdict":"changes_requested","findings":["x"]}')).toEqual({ verdict: "changes_requested", findings: ["x"] });
  });
});
