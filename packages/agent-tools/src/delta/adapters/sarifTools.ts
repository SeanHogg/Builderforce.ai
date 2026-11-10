/**
 * delta/adapters/sarifTools.ts — deep analysis through SARIF (PRD 41 §C5.2, §9, §C12): Semgrep, and CodeQL when the host
 * names a database for the side. The log is parsed with `@builderforce/sarif` (`readSarifResults`, the ONE SARIF reader)
 * and each result becomes a `sast-finding` (security; `confidence: 'measured'`), its rule kept as `params.sarifRule` and its
 * CWE as `params.cwe` — the engine tags it with STRIDE through run-delta's `strideOf` (`registry/stride.ts`).
 *
 * Identity (C3): a result carrying `partialFingerprints['anchor/v1']` (one this platform exported) keeps that anchor, so a
 * re-imported delta matches itself. Any other result is anchored on its file and the tool's rule id
 * (`<path>#<tool>:<rule>` + the normalized-snippet hash when the log has a snippet), never on a line; repeats of one
 * anchor are told apart by their order (`#1`, `#2`, …).
 *
 * Semgrep runs offline: only on the repository's OWN rules, as of the BEFORE side (`side.semgrep.config`; a run cannot
 * silence its own findings), over the side's changed files written to a scratch folder — never `--config auto` (it fetches
 * rules and sends metrics). No rules: `skipped` / `no-config`. Both programs are resolved by absolute path from the
 * user's PATH and run from a neutral folder.
 */

import { anchorWithSnippet, composeAnchor } from '@seanhogg/builderforce-memory/knowledge';
import { ANCHOR_FINGERPRINT, readSarifResults, type SarifResultRecord } from '@builderforce/sarif';
import {
  ANALYZER_TIMEOUT_MS, cutShort, failed, okResult, relPath, resolvedArgv, runFailure, skipped,
  type AnalyzerExec, type AnalyzerRunFinding, type DeltaAnalyzer, type ImportedRuleFinding,
} from './analyzer.js';

export const SEMGREP_TOOL = 'semgrep';
export const CODEQL_TOOL = 'codeql';
/** The finding kind of each SARIF tool (one kind per tool: two tools' findings never pair in lineage). */
export const SARIF_KINDS = { [SEMGREP_TOOL]: 'semgrep-finding', [CODEQL_TOOL]: 'codeql-finding' } as const;

const SEVERITY: Readonly<Record<SarifResultRecord['severity'], ImportedRuleFinding['severity']>> = {
  CRITICAL: 'error', HIGH: 'error', MEDIUM: 'warn', LOW: 'info',
};

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One side's SARIF results → findings (pure), paths made relative to `dir`, sorted, repeats of an anchor numbered. */
export function sarifFindings(sarif: unknown, dir: string, side: 'before' | 'after', kind: string): AnalyzerRunFinding[] {
  const KIND = kind;
  const rows = readSarifResults(sarif).map((r) => {
    const path = r.filePath ? relPath(dir, r.filePath.replace(/^file:\/\//, '')) : '';
    const rule = r.ruleId ?? 'unknown';
    const exported = r.partialFingerprints[ANCHOR_FINGERPRINT];
    const anchor = exported ?? (path
      ? composeAnchor(KIND, 1, 'file', anchorWithSnippet(`${path}#${r.tool}:${rule}`, r.snippet ?? undefined))
      : composeAnchor(KIND, 1, 'group', `${r.tool}:${rule}`));
    return { r, path, rule, anchor };
  }).sort((a, b) => cmp(a.anchor, b.anchor) || (a.r.line ?? 0) - (b.r.line ?? 0) || cmp(a.r.title, b.r.title));
  const seen = new Map<string, number>();
  return rows.map(({ r, path, rule, anchor }): AnalyzerRunFinding => {
    const n = (seen.get(anchor) ?? 0) + 1;
    seen.set(anchor, n);
    const cwe = /CWE-\d+/i.exec(r.cwe ?? '')?.[0]?.toUpperCase();
    return {
      kind: KIND,
      identity: { id: `${KIND}:${anchor}#${n}`, anchor, anchorKind: path ? 'file' : 'group', members: path ? [path] : [] },
      severity: SEVERITY[r.severity],
      confidence: 'measured',
      params: { sarifRule: rule, tool: r.tool, ...(cwe ? { cwe } : {}) },
      evidence: path ? [{ side, path, ...(r.line ? { line: r.line } : {}), note: rule }] : [],
    };
  });
}

const safeRel = (p: string): boolean => !!p && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.split('/').includes('..');
const versionOf = (text: string): string => /(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? '';

async function probe(exec: AnalyzerExec, program: string, signal?: AbortSignal): Promise<{ argv0: string; version: string } | undefined> {
  const argv = await resolvedArgv(exec, program, ['--version']);
  if (!argv) return undefined;
  const r = await exec.run(argv, { cwd: exec.neutralCwd(), timeoutMs: 60_000, ...(signal ? { signal } : {}) });
  return r.started ? { argv0: argv[0]!, version: versionOf(`${r.stdout}\n${r.stderr}`) } : undefined;
}

export const semgrepAnalyzer: DeltaAnalyzer = {
  tool: SEMGREP_TOOL,
  async run(side, exec, signal) {
    const tool = await probe(exec, SEMGREP_TOOL, signal);
    if (!tool) return skipped(SEMGREP_TOOL, 'tool-absent');
    if (side.semgrep?.config === undefined) return skipped(SEMGREP_TOOL, 'no-config', tool.version);
    const files = side.changed.filter((f) => f.text !== undefined && safeRel(f.path));
    if (files.length === 0) return okResult(SEMGREP_TOOL, tool.version, []);
    const scratch = await exec.tempDir();
    try {
      const src = `${scratch.path}/src`;
      for (const f of files) await exec.writeText(`${src}/${f.path}`, f.text!);
      await exec.writeText(`${scratch.path}/rules.yml`, side.semgrep.config);
      const out = `${scratch.path}/semgrep.sarif`;
      const r = await exec.run([tool.argv0, 'scan', '--sarif', '--metrics', 'off', '--disable-version-check', '--config', `${scratch.path}/rules.yml`,
        '--output', out, src], { cwd: scratch.path, timeoutMs: ANALYZER_TIMEOUT_MS, ...(signal ? { signal } : {}) });
      if (!r.started || cutShort(r)) return failed(SEMGREP_TOOL, r.started ? runFailure(r) : 'exit-failed', tool.version);
      const text = await exec.readText(out);
      if (!text) return failed(SEMGREP_TOOL, 'exit-failed', tool.version);
      let log: unknown;
      try { log = JSON.parse(text); } catch { return failed(SEMGREP_TOOL, 'invalid-report', tool.version); }
      return okResult(SEMGREP_TOOL, tool.version, sarifFindings(log, src, side.side, SARIF_KINDS[SEMGREP_TOOL]));
    } finally {
      void scratch.dispose().catch(() => undefined);
    }
  },
};

/** Languages CodeQL extracts without building (`--build-mode=none`); any other is `autobuild` (documented per language). */
const NO_BUILD: ReadonlySet<string> = new Set(['javascript-typescript', 'javascript', 'python', 'java', 'csharp']);

/**
 * `codeql database create <database> --language=<lang> --source-root=<dir> --build-mode=<mode> --overwrite` — every
 * option as the CodeQL CLI manual spells it (`-l, --language`, `-s, --source-root`, `--build-mode`, `--[no-]overwrite`).
 * Extraction is local: nothing is downloaded.
 */
export const codeqlCreateArgv = (program: string, dbDir: string, language: string, sourceRoot: string): string[] =>
  [program, 'database', 'create', dbDir, `--language=${language}`, `--source-root=${sourceRoot}`, `--build-mode=${NO_BUILD.has(language) ? 'none' : 'autobuild'}`, '--overwrite'];

/**
 * `codeql database analyze <database> --format=sarif-latest --output=<file> --no-download` — OFFLINE: `--[no-]download`
 * ("download any missing queries before analyzing") is off, so only the query packs already in this machine's package
 * cache are used; with none, the analysis fails and is reported `failed`.
 */
export const codeqlAnalyzeArgv = (program: string, db: string, out: string): string[] =>
  [program, 'database', 'analyze', db, '--format=sarif-latest', `--output=${out}`, '--no-download'];

/** CodeQL analyses a DATABASE of one tree state: it measures a side only when the host names that side's database. */
export const codeqlAnalyzer: DeltaAnalyzer = {
  tool: CODEQL_TOOL,
  async run(side, exec, signal) {
    const tool = await probe(exec, CODEQL_TOOL, signal);
    if (!tool) return skipped(CODEQL_TOOL, 'tool-absent');
    // Only a repository that opted in (a `.github/codeql/` config, or the setting) is measured: the host then names where
    // this side's database lives; anything else is not measured, never a tool that can never run.
    const create = side.codeql?.create;
    let db = side.codeql?.database;
    if (!db && !create) return skipped(CODEQL_TOOL, 'no-config', tool.version);
    if (!db && create) {
      // A database already built for this tree (the key is in the folder name) is reused; else it is built, offline.
      if (await exec.mtime(`${create.dbDir}/codeql-database.yml`) === undefined) {
        const built = await exec.run(codeqlCreateArgv(tool.argv0, create.dbDir, create.language, side.dir),
          { cwd: exec.neutralCwd(), timeoutMs: ANALYZER_TIMEOUT_MS, ...(signal ? { signal } : {}) });
        if (!built.started || cutShort(built) || built.exitCode !== 0) return failed(CODEQL_TOOL, built.started && !cutShort(built) ? 'exit-failed' : runFailure(built), tool.version);
      }
      db = create.dbDir;
    }
    const scratch = await exec.tempDir();
    try {
      const out = `${scratch.path}/codeql.sarif`;
      const r = await exec.run(codeqlAnalyzeArgv(tool.argv0, db!, out),
        { cwd: exec.neutralCwd(), timeoutMs: ANALYZER_TIMEOUT_MS, ...(signal ? { signal } : {}) });
      if (!r.started || cutShort(r)) return failed(CODEQL_TOOL, r.started ? runFailure(r) : 'exit-failed', tool.version);
      const text = await exec.readText(out);
      let log: unknown;
      try { log = text ? JSON.parse(text) : undefined; } catch { log = undefined; }
      if (!log) return failed(CODEQL_TOOL, 'invalid-report', tool.version);
      return okResult(CODEQL_TOOL, tool.version, sarifFindings(log, side.codeql?.sourceRoot ?? side.dir, side.side, SARIF_KINDS[CODEQL_TOOL]));
    } finally {
      void scratch.dispose().catch(() => undefined);
    }
  },
};
