/**
 * The L3 analyzer tier for ONE repository of a run delta (PRD 41 §B7, §6 "Agent run" step 4): every run-delta
 * `ANALYZER_RULES` tool on both sides, gathered on the extension host as PLAIN DATA ({@link PreparedAnalyzers}) that the
 * worker's `DeltaPorts.analyze` serves (`preparedPorts.ts`). It runs in phase 2, detached, on the background indexer's L3
 * gate (`analyzers/l3Phase.ts`) — never on the delta's synchronous budget.
 *
 *   TRUST    an untrusted workspace runs no tool: every row is `skipped` / `untrusted-workspace`.
 *   AFTER    the working tree, excluding what git ignores (one file universe with the before side).
 *   BEFORE   a whole-tree tool's result from the L3 result cache ({@link fileAnalyzerCache}, keyed by tool, version,
 *            configuration, declared inputs and tree hash); on a miss, a materialized tree as the FALLBACK
 *            ({@link materializeBeforeTree}). Changed-file tools (gitleaks, Semgrep, TypeScript's overlay) need no tree.
 *            After-only rows (coverage) are never run before.
 * After-side results of the whole-tree tools are cached under the after tree's hash: the next run's before side. Nothing
 * is cached when the trees are not content-addressed (no knowledge root), or a tree changed while its tools ran.
 *
 * Never rejects: a tool that cannot run is a `failed`/`skipped` result. Disposal is never awaited on the result path.
 */

import {
  bundledAnalyzers, DELTA_ANALYZERS, failed, onSide, skipped,
  type AnalyzerChangedFile, type AnalyzerExec, type AnalyzerRunResult, type AnalyzerSide, type DeltaAnalyzer,
} from "@builderforce/agent-tools";
import { ANALYZER_RULES, ANALYZER_TOOLS, type AnalyzerResult, type SideText, type UnresolvedFile } from "@builderforce/run-delta";
import type { PreparedDelta } from "../preparedPorts";
import { fileAnalyzerCache, type AnalyzerCache } from "./analyzerCache";
import { l3KeyOf } from "./l3Binding";
import { scopeTreeHash } from "./treeHash";
import { beforeTreeFilesOf, materializeBeforeTree, type MaterializedTree } from "./beforeTree";
import { coverageAnalyzer } from "./coverageAnalyzer";
import { excludeFromPathSearch, nodeAnalyzerExec } from "./nodeAnalyzerExec";
import { pool } from "./pool";
import { runContextOf, type RunContext } from "./sideContext";
import { typescriptAnalyzer } from "./typescriptAnalyzer";
import { bundledTypescriptEntry } from "./typescriptEntry";

/** Both sides' analyzer results of one repository, as the worker's `analyze` port serves them. */
export interface PreparedAnalyzers {
  before: AnalyzerResult[];
  after: AnalyzerResult[];
}

/** Tools in flight at once. */
const CONCURRENCY = 3;

/** Whole-tree tools whose result depends on the tree alone (cached); changed-file tools are cheap and never cached. */
const TREE_TOOLS: ReadonlySet<string> = new Set([
  ANALYZER_TOOLS.osv, ANALYZER_TOOLS.jscpd, ANALYZER_TOOLS.knip, ANALYZER_TOOLS.dependencyCruiser, ANALYZER_TOOLS.codeql,
]);

/** CodeQL's extractor for the repository's main language (by its files); undefined when none it reads. */
export function codeqlLanguageOf(files: readonly string[] | undefined): string | undefined {
  const all = files ?? [];
  if (all.some((p) => /\.(?:[cm]?[jt]sx?)$/i.test(p))) return "javascript-typescript";
  if (all.some((p) => /\.py$/i.test(p))) return "python";
  if (all.some((p) => /\.go$/i.test(p))) return "go";
  return undefined;
}

/** The repository opted in to CodeQL: a `.github/codeql/` configuration, or the setting. */
export const codeqlOptedIn = (files: readonly string[] | undefined, setting: boolean): boolean =>
  setting || (files ?? []).some((p) => p.startsWith(".github/codeql/"));

export interface RepoAnalyzerDeps {
  exec?: AnalyzerExec;
  analyzers?: readonly DeltaAnalyzer[];
  /** Entry scripts of the bundled tools by name; default: the registered VSIX analyzers plus their TypeScript. */
  entries?: () => Readonly<Record<string, string | undefined>>;
  bundled?: boolean;
  cache?: (root: string) => AnalyzerCache;
  materialize?: typeof materializeBeforeTree;
  /** The workspace is trusted (`vscode.workspace.isTrusted`). Default true (tests); the editor passes the real flag. */
  trusted?: () => boolean;
  /** osv-scanner's offline database folder (the extension's global storage) and whether it may be refreshed now. */
  osv?: { dbDir: string; download: boolean };
  /** The shared context; default: read from the repository ({@link runContextOf}). */
  context?: RunContext;
  /** `builderforce.runDelta.analyzers.codeql`: opt in without a `.github/codeql/` configuration. */
  codeql?: boolean;
  /** The tree hash of a side's scope (default: git's, `treeHash.ts`); undefined ⇒ not content-addressed (no cache). */
  treeHash?: (side: "before" | "after", scopes: readonly string[]) => Promise<string | undefined>;
}

/**
 * The workspace packages holding a changed file: each file's nearest folder with a `package.json` (in git's universe),
 * else its top-level folder (`.` for a file at the root). Sorted, deduped; a scope inside another is dropped.
 */
export function packageScopes(changed: readonly string[], universe: readonly string[] | undefined): string[] {
  const manifests = new Set((universe ?? []).filter((p) => p === "package.json" || p.endsWith("/package.json")).map((p) => (p === "package.json" ? "." : p.slice(0, -"/package.json".length))));
  const scopes = new Set<string>();
  for (const file of changed) {
    const parts = file.split("/").slice(0, -1);
    let scope: string | undefined;
    for (let i = parts.length; i > 0 && !scope; i--) { const dir = parts.slice(0, i).join("/"); if (manifests.has(dir)) scope = dir; }
    scopes.add(scope ?? (parts[0] ?? "."));
  }
  const sorted = [...scopes].sort();
  if (sorted.includes(".")) return ["."];
  return sorted.filter((s) => !sorted.some((o) => o !== s && s.startsWith(`${o}/`)));
}

const isText = (v: SideText | UnresolvedFile | undefined): v is SideText => !!v && !("reason" in v);

function defaultEntries(): Record<string, string | undefined> {
  const entries: Record<string, string | undefined> = { ...(bundledAnalyzers() ?? {}) };
  const ts = bundledTypescriptEntry(entries);
  if (ts) entries[ANALYZER_TOOLS.typescript] = ts;
  return entries;
}

/** The analyzers of the editor: agent-tools' adapters plus the host's own (TypeScript's overlay, changed-line coverage). */
export const EDITOR_ANALYZERS: readonly DeltaAnalyzer[] = [...DELTA_ANALYZERS, typescriptAnalyzer, coverageAnalyzer];

/** Runs the tier for one repository. Never rejects. */
export async function analyzeRepo(root: string, prepared: PreparedDelta, deps: RepoAnalyzerDeps = {}, signal?: AbortSignal): Promise<PreparedAnalyzers> {
  const analyzers = deps.analyzers ?? EDITOR_ANALYZERS;
  const byTool = new Map(analyzers.map((a) => [a.tool, a]));
  const rows = ANALYZER_RULES.filter((r) => byTool.has(r.tool));
  const afterTools = rows.map((r) => r.tool);
  const beforeTools = rows.filter((r) => r.sides !== "after").map((r) => r.tool);
  if (deps.trusted && !deps.trusted()) {
    const untrusted = (tool: string) => skipped(tool, "untrusted-workspace");
    return { before: beforeTools.map(untrusted), after: afterTools.map(untrusted) };
  }
  excludeFromPathSearch(root);
  const exec = deps.exec ?? nodeAnalyzerExec;
  const sig = signal ?? new AbortController().signal;
  const entries = (deps.entries ?? defaultEntries)();
  const bundled = deps.bundled ?? bundledAnalyzers() !== undefined;
  const cache = (deps.cache ?? fileAnalyzerCache)(root);
  const ctx = deps.context ?? await runContextOf(root, prepared);

  const before = new Map(prepared.texts.before), after = new Map(prepared.texts.after);
  const inRun = prepared.input.files.filter((f) => f.attribution !== "outside-run").map((f) => f.path).sort();
  const afterChanged: AnalyzerChangedFile[] = inRun.map((p) => {
    const a = after.get(p), b = before.get(p);
    return { path: p, ...(isText(a) && a.text !== undefined ? { text: a.text } : {}), ...(isText(b) && b.text !== undefined ? { beforeText: b.text } : {}) };
  });
  const beforeChanged: AnalyzerChangedFile[] = inRun.map((p) => { const b = before.get(p); return { path: p, ...(isText(b) && b.text !== undefined ? { text: b.text } : {}) }; });
  // jscpd is scoped to the workspace packages holding a changed file — the same directories on both sides; every other
  // whole-tree tool reads the whole tree.
  const jscpdScopes = packageScopes(inRun, ctx.universe);
  const scopesOf = (tool: string): readonly string[] => (tool === ANALYZER_TOOLS.jscpd ? jscpdScopes : ["."]);
  const sideOf = (side: "before" | "after", dir: string, tool?: string): AnalyzerSide => ({
    side, dir, changed: side === "after" ? afterChanged : beforeChanged, entries, bundled, ignored: ctx.ignored,
    ...(tool === ANALYZER_TOOLS.jscpd ? { scopes: jscpdScopes } : {}),
    ...(ctx.before.partitions ? { partitions: ctx.before.partitions } : {}),
    ...(ctx.before.gitleaks ? { gitleaks: ctx.before.gitleaks } : {}),
    ...(ctx.before.semgrep ? { semgrep: ctx.before.semgrep } : {}),
    ...(deps.osv ? { osv: deps.osv } : {}),
  });
  // CodeQL, when the repository opted in: each side's database lives in the L3 cache under that side's key (built once
  // per tree, offline); otherwise the adapter reports `no-config`.
  const codeqlLanguage = codeqlOptedIn(ctx.universe, deps.codeql ?? false) ? codeqlLanguageOf(ctx.universe) : undefined;
  const run = async (tool: string, side: AnalyzerSide): Promise<AnalyzerRunResult> => {
    try {
      if (tool === ANALYZER_TOOLS.codeql && codeqlLanguage) {
        const key = await keyOf(tool, side.side);
        const dbDir = `${root.replace(/\\/g, "/")}/.builderforce/cache/run-delta-analyzers/codeql-${(key ?? `${side.side}-unkeyed`).slice(0, 32)}`;
        side = { ...side, codeql: { create: { dbDir, language: codeqlLanguage }, sourceRoot: side.dir } };
      }
      return await byTool.get(tool)!.run(side, exec, sig);
    } catch {
      return failed(tool, "analyzer-threw");
    }
  };

  const osvDate = deps.osv ? String(await exec.newestMtime(deps.osv.dbDir) ?? "none") : "online";
  // The before side's files as git hashes them: an in-run file's before text, `null` where the run created it.
  const beforeOverrides = new Map<string, string | null>();
  for (const f of prepared.input.files) {
    if (f.attribution === "outside-run") continue;
    const b = before.get(f.path);
    if (f.beforeHash === undefined) beforeOverrides.set(f.path, null);
    else if (isText(b) && b.text !== undefined) beforeOverrides.set(f.path, b.text);
  }
  const treeHash = deps.treeHash ?? ((side: "before" | "after", scopes: readonly string[]) =>
    scopeTreeHash(root, scopes, side === "before" ? beforeOverrides : new Map()));
  // THE L3 key — computed as the background indexer's pass computes it (`l3Binding.ts`): the tree is git's content of
  // the tool's scope (both sides measure the same directories), so either reuses the other's result. Undefined: no cache.
  const keyOf = async (tool: string, side: "before" | "after"): Promise<string | undefined> => {
    const scopes = scopesOf(tool);
    const tree = await treeHash(side, scopes);
    return tree === undefined ? undefined : l3KeyOf({
      tool, side, ctx, entries, inputs: byTool.get(tool)!.inputs, tree, scopes,
      ...(tool === ANALYZER_TOOLS.osv ? { extra: osvDate } : {}),
    });
  };
  const store = (key: string, r: AnalyzerRunResult): Promise<void> => {
    const { raw, ...result } = r;
    return cache.put(key, { result, ...(raw !== undefined ? { raw } : {}) });
  };
  /** A cached result, as this side reads it (the store keeps the writer's side on its evidence). */
  const fromCache = async (key: string, tool: string, side: "before" | "after"): Promise<AnalyzerRunResult | undefined> => {
    const entry = await cache.get(key, tool);
    return entry ? onSide(entry.result, side) : undefined;
  };

  const afterResults = pool(afterTools, CONCURRENCY, async (tool) => {
    const key = TREE_TOOLS.has(tool) ? await keyOf(tool, "after") : undefined;
    // The indexer's pass may already hold this tree's result.
    const hit = key ? await fromCache(key, tool, "after") : undefined;
    if (hit) return hit;
    const r = await run(tool, sideOf("after", root, tool));
    // A working tree that moved while the tool ran is not the tree the key names.
    if (key && key === await keyOf(tool, "after")) await store(key, r);
    return r;
  });

  const beforeResults = (async (): Promise<AnalyzerRunResult[]> => {
    const cached = new Map<string, AnalyzerRunResult>();
    const keys = new Map<string, string>();
    for (const tool of beforeTools.filter((t) => TREE_TOOLS.has(t))) {
      const key = await keyOf(tool, "before");
      if (!key) continue;
      keys.set(tool, key);
      const hit = await fromCache(key, tool, "before");
      if (hit) cached.set(tool, hit);
    }
    const missing = beforeTools.filter((t) => !cached.has(t));
    let tree: MaterializedTree | undefined;
    if (missing.some((t) => TREE_TOOLS.has(t))) tree = await (deps.materialize ?? materializeBeforeTree)(root, beforeTreeFilesOf(prepared), sig);
    try {
      const ran = await pool(missing, CONCURRENCY, async (tool) => {
        if (TREE_TOOLS.has(tool) && !tree) return failed(tool, sig.aborted ? "timeout" : "before-tree-unavailable");
        // Changed-file tools read the before TEXTS (TypeScript through its overlay of the working tree): no tree.
        return run(tool, sideOf("before", TREE_TOOLS.has(tool) ? tree!.dir : root, tool));
      });
      if (tree && !(await tree.changedSince())) {
        for (const [i, tool] of missing.entries()) if (keys.has(tool)) await store(keys.get(tool)!, ran[i]!);
      }
      return beforeTools.map((t) => cached.get(t) ?? ran[missing.indexOf(t)]!);
    } finally {
      void tree?.dispose().catch(() => undefined);
    }
  })();

  const [a, b] = await Promise.all([afterResults, beforeResults]);
  // What concerns THIS run (jscpd: the clone groups a changed file is in), after the cache — which keeps the whole tree.
  const changedPaths = new Set(inRun);
  // The raw report is the cache's only (never the engine's), and only this run's findings go on.
  const relevant = ({ raw: _raw, ...r }: AnalyzerRunResult): AnalyzerResult => {
    const keep = byTool.get(r.tool)?.relevant;
    return keep && r.status === "ok" ? { ...r, findings: r.findings.filter((f) => keep(f, changedPaths)) } : r;
  };
  return { before: b.map(relevant), after: a.map(relevant) };
}
