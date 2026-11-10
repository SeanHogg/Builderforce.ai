/**
 * What several detectors share: the finding constructor, evidence rows, and the per-file write/check ledger that
 * `unverified_writes`, `stopped_unverified` and the report's file list all read — one computation, three readers.
 */
import { RUN_FINDING_POLICY } from './policy';
import type { RunFinding, RunFindingEvidence, RunFindingKind, RunFindingSeverity, RunView, ViewCall, ViewTurn } from './types';

/**
 * A finding; its id is the kind, its subject (the `path` or `tool` param, when it has one) and its first evidence
 * step, so it is stable across recomputes of one run. Two findings one call raises on two paths differ by path;
 * {@link withUniqueIds} settles any remaining tie (two replacements of one file in one batched call).
 */
export function finding(
  kind: RunFindingKind,
  severity: RunFindingSeverity,
  params: Record<string, string | number>,
  evidence: RunFindingEvidence[],
): RunFinding {
  const first = evidence.reduce((min, e) => Math.min(min, e.step), Number.POSITIVE_INFINITY);
  const subject = params.path ?? params.tool;
  const id = `${kind}:${subject !== undefined ? `${subject}:` : ''}${Number.isFinite(first) ? first : 0}`;
  return { id, kind, severity, params, evidence };
}

/** The findings with every id unique: a repeated id gains `#2`, `#3`… in list order (the list is already sorted). */
export function withUniqueIds(findings: readonly RunFinding[]): RunFinding[] {
  const seen = new Map<string, number>();
  return findings.map((f) => {
    const n = (seen.get(f.id) ?? 0) + 1;
    seen.set(f.id, n);
    return n === 1 ? f : { ...f, id: `${f.id}#${n}` };
  });
}

/** One line of quoted text, cut to the excerpt ceiling. */
export function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const max = RUN_FINDING_POLICY.excerptChars;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Evidence pointing at a turn's completion. */
export function turnEvidence(t: ViewTurn, label = 'llm.complete', text?: string): RunFindingEvidence {
  return { step: t.step, turn: t.index, label, ...(text ? { excerpt: excerpt(text) } : {}) };
}

/** Evidence pointing at one tool call (and the path it is about, when given). */
export function callEvidence(c: ViewCall, path?: string, text?: string): RunFindingEvidence {
  return {
    step: c.step,
    ...(c.turn > 0 ? { turn: c.turn } : {}),
    label: c.name,
    ...(path ? { path } : {}),
    ...(text ? { excerpt: excerpt(text) } : {}),
  };
}

/** One written file: how many successful writes, the last of them, and whether a check ran after it. */
export interface FileLedgerRow {
  path: string;
  writes: number;
  lastWrite: ViewCall;
  checked: boolean;
}

/** Every file the run wrote, first-written order. A check covers every write before it. */
export function fileLedger(view: RunView): FileLedgerRow[] {
  const rows = new Map<string, FileLedgerRow>();
  for (const c of view.calls) {
    if (c.check) for (const row of rows.values()) row.checked = true;
    for (const path of c.paths) {
      const row = rows.get(path);
      if (row) {
        row.writes += 1;
        row.lastWrite = c;
        row.checked = false;
      } else {
        rows.set(path, { path, writes: 1, lastWrite: c, checked: false });
      }
    }
  }
  return [...rows.values()];
}

/** The written files no successful check followed. */
export function unverifiedFiles(view: RunView): FileLedgerRow[] {
  return fileLedger(view).filter((r) => !r.checked);
}

/** All successful writes of the run. */
export function writeCalls(view: RunView): ViewCall[] {
  return view.calls.filter((c) => c.write);
}
