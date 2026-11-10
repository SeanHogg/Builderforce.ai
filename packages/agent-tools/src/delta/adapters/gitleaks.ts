/**
 * delta/adapters/gitleaks.ts — secrets in the run's changed files (PRD 41 §C5.5), through gitleaks when it is present
 * on this host, with the PreFetch secrets executor's arguments and report parser (`prefetch/checkExecutors.ts`).
 *
 * Only the CHANGED files are scanned, on each side: their side texts are written to a scratch directory and scanned
 * there with `--no-git`, so a secret the run added is `introduced` and one it removed is `resolved`. The report is
 * written `--redact`, and the finding carries the rule and file only — a secret value never reaches a delta.
 * Every hit is an error. Identity: `<file>#<rule>`, the n-th hit of that rule in the file (by line), never the line.
 */

import { composeAnchor } from '@seanhogg/builderforce-memory/knowledge';
import { jsonIn } from '../../prefetch/exec.js';
import { gitleaksDetectArgs, gitleaksLeaks, type GitleaksLeak } from '../../prefetch/checkExecutors.js';
import {
  ANALYZER_TIMEOUT_MS, cutShort, failed, okResult, relPath, resolvedArgv, runFailure, skipped, type AnalyzerRunFinding, type DeltaAnalyzer,
} from './analyzer.js';

export const GITLEAKS_TOOL = 'gitleaks';
const KIND = 'secret-leak';

/** The report's hits → findings, ordinal per (file, rule) by line (pure). */
export function gitleaksFindings(leaks: readonly GitleaksLeak[], dir: string, side: 'before' | 'after'): AnalyzerRunFinding[] {
  const sorted = leaks.map((l) => ({ ...l, file: relPath(dir, l.file) }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0) || a.line - b.line);
  const seen = new Map<string, number>();
  return sorted.map((l) => {
    const primary = `${l.file}#${l.rule}`;
    const n = (seen.get(primary) ?? 0) + 1;
    seen.set(primary, n);
    return {
      kind: KIND,
      identity: { id: `${KIND}:${primary}:${n}`, anchor: composeAnchor(KIND, 1, 'file', primary), anchorKind: 'file', members: [l.file] },
      severity: 'error',
      confidence: 'measured',
      params: { rule: l.rule },
      evidence: [{ side, path: l.file, ...(l.line > 0 ? { line: l.line } : {}) }],
    };
  });
}

export const gitleaksVersion = (text: string): string => /(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? '';

/** Changed-file paths that are safe to recreate under a scratch directory. */
const safeRel = (p: string): boolean => !!p && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.split('/').includes('..');

export const gitleaksAnalyzer: DeltaAnalyzer = {
  tool: GITLEAKS_TOOL,
  async run(side, exec, signal) {
    const probe = await resolvedArgv(exec, GITLEAKS_TOOL, ['version']);
    if (!probe) return skipped(GITLEAKS_TOOL, 'tool-absent');
    const p = await exec.run(probe, { cwd: exec.neutralCwd(), timeoutMs: 30_000, ...(signal ? { signal } : {}) });
    if (!p.started) return skipped(GITLEAKS_TOOL, 'tool-absent');
    const version = gitleaksVersion(`${p.stdout}\n${p.stderr}`);
    const files = side.changed.filter((f) => f.text !== undefined && safeRel(f.path));
    if (files.length === 0) return okResult(GITLEAKS_TOOL, version, []);
    const scratch = await exec.tempDir();
    try {
      const src = `${scratch.path}/src`;
      for (const f of files) await exec.writeText(`${src}/${f.path}`, f.text!);
      // The repository's own config and ignore list, AS OF THE BEFORE SIDE: a run cannot silence its own leaks.
      const extra = ['--no-git', '--exit-code', '0'];
      if (side.gitleaks?.config !== undefined) { await exec.writeText(`${scratch.path}/gitleaks.toml`, side.gitleaks.config); extra.push('--config', `${scratch.path}/gitleaks.toml`); }
      if (side.gitleaks?.ignore !== undefined) { await exec.writeText(`${scratch.path}/.gitleaksignore`, side.gitleaks.ignore); extra.push('--gitleaks-ignore-path', `${scratch.path}/.gitleaksignore`); }
      const report = `${scratch.path}/report.json`;
      const r = await exec.run([probe[0]!, ...gitleaksDetectArgs(src, report, extra)],
        { cwd: scratch.path, timeoutMs: ANALYZER_TIMEOUT_MS, ...(signal ? { signal } : {}) });
      if (!r.started || cutShort(r)) return failed(GITLEAKS_TOOL, r.started ? runFailure(r) : 'exit-failed', version);
      const leaks = gitleaksLeaks(jsonIn((await exec.readText(report)) ?? ''));
      if (!leaks) return failed(GITLEAKS_TOOL, r.exitCode === 0 ? 'invalid-report' : 'exit-failed', version);
      return okResult(GITLEAKS_TOOL, version, gitleaksFindings(leaks, src, side.side));
    } finally {
      void scratch.dispose().catch(() => undefined);
    }
  },
};
