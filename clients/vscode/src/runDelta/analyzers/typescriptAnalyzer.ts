/**
 * The `typescript` analyzer of the run delta (PRD 41 §C8.1): type errors in the run's changed files, from the bundled
 * compiler (`TYPESCRIPT_PIN`, beside the VSIX's analyzers) — run in a WORKER THREAD (never on the extension host's
 * thread; terminated at {@link ANALYZER_TIMEOUT_MS}) through the compiler API with an in-memory OVERLAY host:
 *
 *   after   the working tree as it is;
 *   before  the working tree with the run's changed files swapped to their before text (a file the run created is
 *           absent, one it deleted is present) — no tree is materialized for it.
 *
 * Each changed file's nearest `tsconfig.json` is checked (at most `MAX_PROJECTS`), `noEmit`, `incremental: false`,
 * `composite: false` (nothing is ever written; no `.tsbuildinfo` is read), and files under `.builderforce/` (the
 * materialized trees) are never part of a program. The diagnostics map to findings in agent-tools (`typeErrorFindings`).
 */

import * as path from "node:path";
import { Worker } from "node:worker_threads";
import {
  ANALYZER_TIMEOUT_MS, failed, missingReason, okResult, skipped, tsProjectsOf, typeErrorFindings, TYPESCRIPT_TOOL, TYPESCRIPT_VERSION,
  type DeltaAnalyzer, type TscDiagnostic,
} from "@builderforce/agent-tools";

/** The worker: plain JS (it runs as given), loads the bundled compiler by its absolute path. */
const WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const ts = require(workerData.tsModule);
const key = (p) => { const n = path.resolve(p).replace(/\\\\/g, '/'); return workerData.fold ? n.toLowerCase() : n; };
const overlay = new Map(Object.entries(workerData.overlay).map(([p, t]) => [key(p), t]));
const exists = (p) => { const k = key(p); return overlay.has(k) ? overlay.get(k) !== null : ts.sys.fileExists(p); };
const read = (p) => { const k = key(p); return overlay.has(k) ? (overlay.get(k) ?? undefined) : ts.sys.readFile(p); };
const skip = (p) => /(^|\\/)\\.builderforce\\//.test(key(p).slice(key(workerData.root).length));
const out = [];
for (const project of workerData.projects) {
  const cfgPath = path.join(workerData.root, project);
  const cfg = ts.readConfigFile(cfgPath, read);
  if (cfg.error) continue;
  const parseHost = { useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames, readDirectory: ts.sys.readDirectory, fileExists: exists, readFile: read };
  const parsed = ts.parseJsonConfigFileContent(cfg.config, parseHost, path.dirname(cfgPath));
  const options = { ...parsed.options, noEmit: true, incremental: false, composite: false, tsBuildInfoFile: undefined, declaration: false };
  const dir = key(path.dirname(cfgPath));
  const names = new Set(parsed.fileNames.filter((f) => exists(f) && !skip(f)));
  for (const [k, t] of overlay) if (t !== null && k.startsWith(dir + '/') && /\\.[cm]?tsx?$/.test(k)) names.add(k);
  const host = ts.createCompilerHost(options);
  host.fileExists = exists;
  host.readFile = read;
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, onError) => {
    const k = key(f);
    if (overlay.has(k)) { const t = overlay.get(k); return t === null ? undefined : ts.createSourceFile(f, t, lang); }
    return getSourceFile(f, lang, onError);
  };
  const program = ts.createProgram([...names], options, host);
  for (const changed of workerData.changed) {
    const sf = program.getSourceFile(path.join(workerData.root, changed));
    if (!sf) continue;
    for (const d of [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]) {
      if (d.category !== ts.DiagnosticCategory.Error || d.start === undefined) continue;
      const line = sf.getLineAndCharacterOfPosition(d.start).line + 1;
      out.push({ file: changed, line, code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, ' ') });
    }
  }
}
parentPort.postMessage(out);
`;

/** The compiler module beside the bundled `bin/tsc` entry. */
const moduleOf = (tscEntry: string): string => path.join(path.dirname(tscEntry), "..", "lib", "typescript.js");

function check(data: { tsModule: string; root: string; projects: string[]; changed: string[]; overlay: Record<string, string | null>; fold: boolean }, signal?: AbortSignal):
  Promise<TscDiagnostic[] | "timeout" | "failed"> {
  return new Promise((resolve) => {
    let worker: Worker;
    try { worker = new Worker(WORKER, { eval: true, workerData: data }); } catch { resolve("failed"); return; }
    const timer = setTimeout(() => { void worker.terminate(); resolve("timeout"); }, ANALYZER_TIMEOUT_MS);
    const onAbort = (): void => { void worker.terminate(); resolve("timeout"); };
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = (): void => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); };
    worker.once("message", (d: TscDiagnostic[]) => { done(); void worker.terminate(); resolve(d); });
    worker.once("error", () => { done(); resolve("failed"); });
    worker.once("exit", () => { done(); resolve("failed"); });
  });
}

export const typescriptAnalyzer: DeltaAnalyzer = {
  tool: TYPESCRIPT_TOOL,
  async run(side, exec, signal) {
    const entry = side.entries[TYPESCRIPT_TOOL];
    if (!entry) return skipped(TYPESCRIPT_TOOL, missingReason(side), TYPESCRIPT_VERSION);
    // The overlay: on the before side the changed files' before texts (absent ⇒ the file did not exist then).
    const overlay: Record<string, string | null> = {};
    if (side.side === "before") for (const f of side.changed) overlay[path.join(side.dir, f.path)] = f.text ?? null;
    const projects = await tsProjectsOf({ dir: side.dir, changed: side.changed }, { mtime: async (p) => (overlay[path.join(p)] === null ? undefined : exec.mtime(p)) });
    const changed = side.changed.filter((f) => f.text !== undefined).map((f) => f.path);
    if (projects.length === 0 || changed.length === 0) return okResult(TYPESCRIPT_TOOL, TYPESCRIPT_VERSION, []);
    const r = await check({ tsModule: moduleOf(entry), root: side.dir, projects, changed, overlay, fold: process.platform === "win32" }, signal);
    if (r === "timeout") return failed(TYPESCRIPT_TOOL, "timeout", TYPESCRIPT_VERSION);
    if (r === "failed") return failed(TYPESCRIPT_TOOL, "exit-failed", TYPESCRIPT_VERSION);
    return okResult(TYPESCRIPT_TOOL, TYPESCRIPT_VERSION, typeErrorFindings(r, side.dir, new Set(changed), side.side));
  },
};
