'use client';

import { useCallback, useState } from 'react';
import { importRows, type ImportResult } from './importApi';
import { EMPTY_IMPORT_RESULT, mergeImportResults, planBatches } from './importHelpers';

/**
 * The bulk file's submit loop: rows → batches of ≤ IMPORT_BATCH_SIZE → one
 * `POST /api/import/:kind` each, in order, with `rowOffset` so the server's
 * `row N` errors count from the file. `check` runs the same loop with
 * `dryRun: true` — the server validates every row and writes nothing — and
 * `run` writes for real. Both aggregate the batch results into one file-level
 * `ImportResult`; `posted / total` is the progress the page shows, and it is
 * real: it moves when a batch is acknowledged, not on a timer.
 */
export type BulkImportPhase = 'idle' | 'checking' | 'importing' | 'done' | 'failed';

export interface BulkImportSubmit {
  phase: BulkImportPhase;
  /** Rows the server has acknowledged so far, of `total`. */
  posted: number;
  total: number;
  /** The aggregate of every batch answered so far (partial while importing). */
  result: ImportResult | null;
  /** Why the loop stopped early, when it did. Batches already acknowledged stay written. */
  failure: string | null;
  check: (rows: Array<Record<string, unknown>>) => Promise<ImportResult | null>;
  run: (rows: Array<Record<string, unknown>>) => Promise<ImportResult | null>;
  reset: () => void;
}

interface State {
  phase: BulkImportPhase;
  posted: number;
  total: number;
  result: ImportResult | null;
  failure: string | null;
}

const IDLE: State = { phase: 'idle', posted: 0, total: 0, result: null, failure: null };

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function useBulkImportSubmit(kind: string): BulkImportSubmit {
  const [state, setState] = useState<State>(IDLE);

  const runBatches = useCallback(async (rows: Array<Record<string, unknown>>, dryRun: boolean): Promise<ImportResult> => {
    let aggregate: ImportResult = { ...EMPTY_IMPORT_RESULT, dryRun };
    setState({ phase: dryRun ? 'checking' : 'importing', posted: 0, total: rows.length, result: null, failure: null });
    for (const batch of planBatches(rows)) {
      const answer = await importRows(kind, batch.rows, { dryRun, rowOffset: batch.offset });
      aggregate = mergeImportResults(aggregate, answer);
      const posted = batch.offset + batch.rows.length;
      const snapshot = aggregate;
      setState((prev) => ({ ...prev, posted, result: snapshot }));
    }
    return aggregate;
  }, [kind]);

  const check = useCallback(async (rows: Array<Record<string, unknown>>): Promise<ImportResult | null> => {
    try {
      const verdict = await runBatches(rows, true);
      // A dry run leaves nothing behind: the page keeps the verdict, not the hook.
      setState(IDLE);
      return verdict;
    } catch (err) {
      setState({ ...IDLE, phase: 'failed', failure: messageOf(err) });
      return null;
    }
  }, [runBatches]);

  const run = useCallback(async (rows: Array<Record<string, unknown>>): Promise<ImportResult | null> => {
    try {
      const written = await runBatches(rows, false);
      setState((prev) => ({ ...prev, phase: 'done', result: written }));
      return written;
    } catch (err) {
      setState((prev) => ({ ...prev, phase: 'failed', failure: messageOf(err) }));
      return null;
    }
  }, [runBatches]);

  const reset = useCallback(() => setState(IDLE), []);

  return { ...state, check, run, reset };
}
