/**
 * The editor's ship-gate ports (PRD 46 §3.6, F3): what a run is handed beside `needsConfirm`.
 * Fakes stand in for the editor, git and the disk; the composition under test is the real one.
 */
import * as path from "path";
import { describe, expect, it } from "vitest";
import type { BrainStreamFn } from "@seanhogg/builderforce-brain-embedded";
import { createShipPorts, parseReviewReply, catalogModelIds } from "./shipPorts";
import { REVIEW_DIFF_BUDGET_CHARS, budgetReviewDiff } from "./reviewerPort";
import type { VscodeLike } from "./pathDiagnostics";
import type { GitRunner } from "./gitPort";
import type { ModelChoices } from "../gateway";

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

/** A fake model catalog: BYO pool + plan pool + premium + configured. */
function fakeCatalog(overrides: Partial<ModelChoices> = {}): ModelChoices {
  return {
    models: [],
    freeModels: [],
    configuredModels: [],
    canUsePremiumModels: false,
    premiumModels: [],
    canChooseModel: true,
    canUseFrontierModels: false,
    byo: { providers: [], models: [] },
    teacherModels: [],
    identity: { plan: "free" },
    ...overrides,
  } as unknown as ModelChoices;
}

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
      settings: { phaseModels: { review: "reviewer-model", verify: "legacy-model", code: "author-model" } },
    });
    const verdict = await ports.reviewer.review({ repo: ROOT, diff: "diff", evidence: "", authorModels: ["author-model"] });
    expect(asked).toEqual([{ model: "reviewer-model", modelStrict: true, role: "review" }]);
    expect(verdict).toMatchObject({ reviewerModel: "reviewer-model", verdict: "approved" });
  });

  it("falls back to the legacy verify stage pin when no review pin is set", async () => {
    const asked: { model?: string }[] = [];
    const stream: BrainStreamFn = async (opts) => {
      asked.push({ model: opts.model });
      return { text: '{"verdict":"approved","findings":[]}', toolCalls: [], finishReason: "stop" };
    };
    const ports = createShipPorts({ vscode: fakeVscode([]), git: async () => ({ stdout: "", exitCode: 0 }) })({
      root: ROOT,
      stream,
      settings: { phaseModels: { verify: "legacy-model", code: "author-model" } },
    });
    await ports.reviewer.review({ repo: ROOT, diff: "diff", evidence: "", authorModels: ["author-model"] });
    expect(asked).toEqual([{ model: "legacy-model" }]);
  });

  it("auto-switches to a catalog model when only the author is in the run's pins", async () => {
    const asked: { model?: string }[] = [];
    const stream: BrainStreamFn = async (opts) => {
      asked.push({ model: opts.model });
      return { text: '{"verdict":"approved","findings":[]}', toolCalls: [], finishReason: "stop" };
    };
    const catalog = fakeCatalog({ models: ["author-model", "pool-model"] });
    const ports = createShipPorts({
      vscode: fakeVscode([]),
      git: async () => ({ stdout: "", exitCode: 0 }),
      getCatalog: async () => catalog,
    })({ root: ROOT, stream, settings: { phaseModels: { code: "author-model" } } });
    const verdict = await ports.reviewer.review({ repo: ROOT, diff: "diff", evidence: "", authorModels: ["author-model"] });
    expect(asked).toEqual([{ model: "pool-model" }]);
    expect(verdict).toMatchObject({ reviewerModel: "pool-model", verdict: "approved" });
    // The switch is named in the advisories so the user sees what happened (never in
    // `findings` — an advisory must not block the push).
    if (!("refused" in verdict)) expect(verdict.advisories?.join(" ")).toContain("pool-model");
  });

  it("prefers a BYO catalog model over a gateway-pool model for the auto-switch", async () => {
    const asked: { model?: string }[] = [];
    const stream: BrainStreamFn = async (opts) => {
      asked.push({ model: opts.model });
      return { text: '{"verdict":"approved","findings":[]}', toolCalls: [], finishReason: "stop" };
    };
    // BYO listed before the pool model — catalogModelIds keeps that order.
    const catalog = fakeCatalog({
      byo: { providers: ["anthropic"], models: [{ id: "byo-model", vendor: "anthropic", tier: "byo" }] },
      models: ["pool-model"],
    });
    const ports = createShipPorts({
      vscode: fakeVscode([]),
      git: async () => ({ stdout: "", exitCode: 0 }),
      getCatalog: async () => catalog,
    })({ root: ROOT, stream, settings: { phaseModels: { code: "author-model" } } });
    await ports.reviewer.review({ repo: ROOT, diff: "diff", evidence: "", authorModels: ["author-model"] });
    expect(asked).toEqual([{ model: "byo-model" }]);
  });

  it("refuses with an actionable message when the catalog has only the author model", async () => {
    const stream: BrainStreamFn = async () => ({ text: "", toolCalls: [], finishReason: "stop" });
    const catalog = fakeCatalog({ models: ["author-model"] });
    const ports = createShipPorts({
      vscode: fakeVscode([]),
      git: async () => ({ stdout: "", exitCode: 0 }),
      getCatalog: async () => catalog,
    })({ root: ROOT, stream, settings: { phaseModels: { code: "author-model" } } });
    const res = await ports.reviewer.review({ repo: ROOT, diff: "diff", evidence: "", authorModels: ["author-model"] });
    expect("refused" in res).toBe(true);
    if ("refused" in res) {
      expect(res.refused).toContain("author-model");
      expect(res.refused).toContain("non-author");
      // The path forward: a pool/BYO model or adding a model.
      expect(res.refused).toMatch(/pool|BYO/i);
      expect(res.refused).toMatch(/second model|add one/i);
    }
  });
});

describe("catalogModelIds", () => {
  it("orders BYO before pool before premium before configured, de-duplicated", () => {
    const ids = catalogModelIds(fakeCatalog({
      byo: { providers: [], models: [{ id: "dup", vendor: "x", tier: "byo" }, { id: "byo-1", vendor: "x", tier: "byo" }] },
      models: ["dup", "pool-1"],
      premiumModels: ["prem-1", "byo-1"],
      configuredModels: [{ ref: "cfg-1", name: "Custom" }],
    }));
    expect(ids).toEqual(["dup", "byo-1", "pool-1", "prem-1", "cfg-1"]);
  });
});

describe("parseReviewReply", () => {
  it("never reads a non-JSON reply as approval — it is a failure, not a changes_requested verdict", () => {
    expect(parseReviewReply("Looks good to me!")).toEqual({ failed: "The reviewer did not return a JSON verdict; review again." });
    expect(parseReviewReply('{"verdict":"changes_requested","findings":["x"]}')).toEqual({ verdict: "changes_requested", findings: ["x"] });
  });

  it("keeps the structured resolution answer: unresolved indices become unresolvedPrior", () => {
    const reply = parseReviewReply('{"blocking":["a.ts:1 one"],"advisory":["nit"],"unresolved":[1]}');
    expect(reply).toEqual({ verdict: "changes_requested", findings: ["a.ts:1 one"], advisories: ["nit"], unresolvedPrior: [1] });
    // Accepts the explicit-key alias too, and an empty list is preserved ("reviewer answered: none left").
    expect(parseReviewReply('{"blocking":[],"unresolved":[]}')).toEqual({ verdict: "approved", findings: [], unresolvedPrior: [] });
    expect(parseReviewReply('{"blocking":[],"unresolvedPrior":[2]}')).toEqual({ verdict: "approved", findings: [], unresolvedPrior: [2] });
    // No resolution key → field absent (cap falls back to text match).
    expect(parseReviewReply('{"blocking":["a.ts:1 one"]}')).toEqual({ verdict: "changes_requested", findings: ["a.ts:1 one"] });
  });

  it("drops non-integer, sub-1 and non-numeric unresolved entries instead of failing the reply", () => {
    expect(parseReviewReply('{"blocking":[],"unresolved":[1,"two",null,3.5,0,-2]}')).toEqual({ verdict: "approved", findings: [], unresolvedPrior: [1] });
  });
});

describe("review prompt (rounds, resolution, diff budget)", () => {
  // A review-stage pin so a reviewer model is always picked and the sub-run's prompt is sent.
  const settings = { phaseModels: { review: "reviewer-model" as const } };
  const make = (stream: BrainStreamFn) =>
    createShipPorts({ vscode: fakeVscode([]), git: async () => ({ stdout: "", exitCode: 0 }) })({ root: ROOT, stream, settings });

  it("asks a re-review to resolve the prior blockers with a numbered list and an unresolved field", async () => {
    let prompt = "";
    const stream: BrainStreamFn = async (opts) => {
      prompt = String(opts.messages[0]?.content ?? "");
      return { text: '{"blocking":[]}', toolCalls: [], finishReason: "stop" };
    };
    const review = await make(stream).reviewer.review({
      repo: ROOT,
      diff: "diff",
      evidence: "ev",
      authorModels: ["author-model"],
      priorBlocking: ["a.ts:1 first blocker", "b.ts:2 second blocker"],
      round: 2,
    });
    expect("refused" in review).toBe(false);
    expect(prompt).toContain('"unresolved": number[]');
    expect(prompt).toContain("1. a.ts:1 first blocker");
    expect(prompt).toContain("2. b.ts:2 second blocker");
    // Round 2 is below the cap: no resolution-only line yet.
    expect(prompt).not.toContain("resolution-only");
  });

  it("adds the resolution-only instruction at and past the cap round", async () => {
    let prompt = "";
    const stream: BrainStreamFn = async (opts) => {
      prompt = String(opts.messages[0]?.content ?? "");
      return { text: '{"blocking":[]}', toolCalls: [], finishReason: "stop" };
    };
    await make(stream).reviewer.review({
      repo: ROOT,
      diff: "diff",
      evidence: "",
      authorModels: ["author-model"],
      priorBlocking: ["a.ts:1 first blocker"],
      round: 3,
    });
    expect(prompt).toContain("resolution-only");
  });

  it("budgets an over-budget diff to whole per-file chunks and names the omitted files", async () => {
    let prompt = "";
    const stream: BrainStreamFn = async (opts) => {
      prompt = String(opts.messages[0]?.content ?? "");
      return { text: '{"blocking":[]}', toolCalls: [], finishReason: "stop" };
    };
    const file = (n: string, body: string) => `diff --git a/src/${n} b/src/${n}\nindex 000..111 100644\n--- a/src/${n}\n+++ b/src/${n}\n${body}`;
    const big =
      file("a.ts", "+" + "a".repeat(30_000) + "\n") +
      file("b.ts", "+" + "b".repeat(30_000) + "\n") +
      file("c.ts", "+c\n");
    expect(big.length).toBeGreaterThan(REVIEW_DIFF_BUDGET_CHARS);
    await make(stream).reviewer.review({ repo: ROOT, diff: big, evidence: "", authorModels: ["author-model"] });
    // Whole-file chunks: a.ts fits the budget alone; b.ts would overflow it, so it is
    // omitted by name; c.ts is omitted too.
    expect(prompt).toContain("[partial view:");
    expect(prompt).toContain("omitted entirely: src/b.ts, src/c.ts");
    expect(prompt).not.toContain("+c\n");
    expect(prompt).not.toContain("+" + "b".repeat(100));
    expect(prompt).toContain("+" + "a".repeat(100));
  });

  it("keeps the full diff when it fits the budget", () => {
    const diff = "diff --git a/src/x.ts b/src/x.ts\n+x\n";
    expect(budgetReviewDiff(diff)).toBe(diff);
  });
});
