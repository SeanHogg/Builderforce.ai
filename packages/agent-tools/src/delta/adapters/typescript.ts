/**
 * delta/adapters/typescript.ts — type errors in the run's changed files (PRD 41 §C8.1): the pure half. The bundled
 * `typescript` (the pin the analyzers ship, `TYPESCRIPT_PIN`) is run by the HOST, in process isolation, over an
 * in-memory overlay of the side (the working tree with the run's changed files swapped to that side's text — no tree
 * is materialized); the host hands the diagnostics here. Only diagnostics IN a changed file are kept.
 *
 * Identity: `<file>#TS<code>` plus the normalized message hash, the n-th such diagnostic by line — never the line,
 * so an edit above a pre-existing error leaves it `persisting`.
 */

import { anchorWithSnippet, composeAnchor } from '@seanhogg/builderforce-memory/knowledge';
import { TYPESCRIPT_PIN } from '../../analyzerPins.js';
import { relPath, type AnalyzerExec, type AnalyzerRunFinding, type AnalyzerSide } from './analyzer.js';

export const TYPESCRIPT_TOOL = 'typescript';
/** The pinned version the host loads (and the delta reports). */
export const TYPESCRIPT_VERSION = TYPESCRIPT_PIN.slice(TYPESCRIPT_PIN.lastIndexOf('@') + 1);
const KIND = 'type-error';
const TS_FILE = /\.(?:[cm]?tsx?)$/i;
/** At most this many projects are type-checked per side. */
export const MAX_PROJECTS = 4;
const MAX_MESSAGE = 200;

export interface TscDiagnostic { file: string; line: number; code: number; message: string }

/** Diagnostics in the changed files → findings (pure). */
export function typeErrorFindings(diagnostics: readonly TscDiagnostic[], dir: string, changed: ReadonlySet<string>, side: 'before' | 'after'): AnalyzerRunFinding[] {
  const kept = diagnostics.map((d) => ({ ...d, file: relPath(dir, d.file) })).filter((d) => changed.has(d.file))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.line - b.line || a.code - b.code || (a.message < b.message ? -1 : 1));
  const seen = new Map<string, number>();
  const out = new Map<string, AnalyzerRunFinding>();
  for (const d of kept) {
    const primary = anchorWithSnippet(`${d.file}#TS${d.code}`, d.message);
    const n = (seen.get(primary) ?? 0) + 1;
    seen.set(primary, n);
    const id = `${KIND}:${primary}:${n}`;
    out.set(id, {
      kind: KIND,
      identity: { id, anchor: composeAnchor(KIND, 1, 'file', primary), anchorKind: 'file', members: [d.file] },
      severity: 'error', confidence: 'measured', params: { code: `TS${d.code}` },
      evidence: [{ side, path: d.file, line: d.line, snippet: d.message.slice(0, MAX_MESSAGE) }],
    });
  }
  return [...out.values()];
}

/** The nearest `tsconfig.json` (root-relative) of each changed TypeScript file present on this side, sorted, capped. */
export async function tsProjectsOf(side: Pick<AnalyzerSide, 'dir' | 'changed'>, exec: Pick<AnalyzerExec, 'mtime'>): Promise<string[]> {
  const found = new Set<string>();
  for (const f of side.changed) {
    if (f.text === undefined || !TS_FILE.test(f.path)) continue;
    const parts = f.path.split('/').slice(0, -1);
    for (let i = parts.length; i >= 0; i--) {
      const rel = [...parts.slice(0, i), 'tsconfig.json'].join('/');
      if (await exec.mtime(`${side.dir}/${rel}`) !== undefined) { found.add(rel); break; }
    }
  }
  return [...found].sort().slice(0, MAX_PROJECTS);
}
