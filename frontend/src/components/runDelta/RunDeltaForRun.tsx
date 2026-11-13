/**
 * A run's Run Delta on the web (PRD 41 §C11.1): the shared `RunDeltaCard` for each repository the run touched, and the
 * panel behind "Open details". Self-contained: it reads `GET /api/run-deltas/:runId` through the typed client and renders
 * nothing when the run has no delta (yet), the surface is not available to this reader, or the read failed — a run view
 * never shows an error for an optional section.
 *
 * The cloud computes the delta AFTER the run settles, so nothing is read while the run is still going (`settled` is null).
 * Once it settles (a TERMINAL status, `runDeltaSettle.ts`) the read repeats on the ONE polling primitive while there is no
 * delta or one is still `pending`, within that status's read budget, and stops for good once every delta is final or the
 * reader is not entitled.
 */

import { useCallback, useState } from 'react';
import {
  CopiedNote,
  CopyFallback,
  RunDeltaCard,
  repoDisplayName,
  resolveDirectiveText,
  runDeltaDiagnosticsText,
  useCopyText,
} from '@builderforce/knowledge-graph-view';
import type { RunDelta } from '@builderforce/run-delta';
import { usePolledResource } from '@/hooks/usePolledResource';
import { getRunDeltas, isRunDeltaUnavailable, type StoredRunDelta } from '@/lib/runDeltasApi';
import { useRunDeltaLabels } from '@/lib/knowledge/runDeltaLabels';
import { deltaReadBudget } from '@/lib/runDeltaSettle';
import { RunDeltaSlideOut } from './RunDeltaSlideOut';

/** At the base interval the budget (`deltaReadBudget`) is ten minutes for a completed or failed run, one for a cancelled one. */
const POLL_MS = 15_000;

/** Final: present and not marked pending (`RunDelta.status` absent ⇒ final). */
const allFinal = (deltas: readonly StoredRunDelta[]): boolean =>
  deltas.length > 0 && deltas.every((d) => (d.delta as { status?: string }).status !== 'pending');

export interface RunDeltaForRunProps {
  runId: string;
  /** The run's TERMINAL status (`settledRunStatus`); null while it can still change. */
  settled: string | null;
  /**
   * Seeded with the shared resolve directive when the user clicks "Resolve" on a delta
   * (PRD 41 §C11). The host owns the composer — the directive is only PRE-FILLED; the
   * user reviews and sends it as a new run's directive. Never auto-dispatches.
   */
  onResolveDelta?: ((text: string) => void) | undefined;
}

export function RunDeltaForRun({ runId, settled, onResolveDelta }: RunDeltaForRunProps) {
  const { labels } = useRunDeltaLabels();
  // The ONE copy behaviour (shared with the knowledge-graph view): clipboard +
  // Copied / Copy-failed feedback for "Copy diagnostics".
  const copier = useCopyText();
  // The last diagnostics text we handed to the clipboard, shown in the select-by-hand
  // fallback when the clipboard refuses.
  const [lastCopied, setLastCopied] = useState<{ text: string; key: string } | null>(null);
  const [deltas, setDeltas] = useState<StoredRunDelta[]>([]);
  const [done, setDone] = useState(false);
  const [openRepo, setOpenRepo] = useState<string | null>(null);

  // A new run selected: start over (state reset during render, before the poll restarts on the new key).
  const [forRun, setForRun] = useState(runId);
  if (forRun !== runId) {
    setForRun(runId);
    setDeltas([]);
    setDone(false);
    setOpenRepo(null);
  }

  const load = useCallback(async (signal: AbortSignal): Promise<void> => {
    let next: StoredRunDelta[];
    try {
      next = await getRunDeltas(runId, { signal });
    } catch (error) {
      if (signal.aborted) return;
      // Not entitled / unknown run: stop asking, quietly.
      if (isRunDeltaUnavailable(error)) { setDone(true); return; }
      // Any other failure: let the poll back off. Rethrown as a plain Error so a fault never surfaces as this read's.
      throw new Error('run_delta_read_failed');
    }
    if (signal.aborted) return;
    setDeltas(next);
    if (allFinal(next)) setDone(true);
  }, [runId]);

  usePolledResource(load, {
    intervalMs: POLL_MS,
    enabled: settled !== null && !done,
    // Past the budget the poll simply stops: no delta, no error (the run view stays as it was).
    maxTicks: settled !== null ? deltaReadBudget(settled) : 0,
    restartKey: `${runId}\u0000${settled ?? ''}`,
  });

  if (deltas.length === 0) return null;
  const open = deltas.find((d) => d.repoKey === openRepo)?.delta ?? null;
  return (
    <div data-run-delta-for-run={runId} style={{ display: 'grid', gap: 8, marginBottom: 12, minWidth: 0 }}>
      {deltas.map((d) => {
        const handleResolve = (): void => onResolveDelta?.(resolveDirectiveText(labels, d.delta as RunDelta));
        const handleCopy = (): void => {
          const text = runDeltaDiagnosticsText(labels, d.delta as RunDelta, new Date().toISOString());
          setLastCopied({ text, key: d.repoKey });
          void copier.copy(text);
        };
        return (
          <RunDeltaCard
            key={d.repoKey}
            delta={d.delta}
            labels={labels}
            repoLabel={deltas.length > 1 ? repoDisplayName(d.repoKey) : undefined}
            onOpenDetails={() => setOpenRepo(d.repoKey)}
            onResolve={onResolveDelta ? handleResolve : undefined}
            onCopyDiagnostics={handleCopy}
          />
        );
      })}
      <CopiedNote status={copier.status} labels={labels} />
      {lastCopied && (
        <CopyFallback status={copier.status} text={lastCopied.text} label={labels.copyDiagnostics} labels={labels} />
      )}
      <RunDeltaSlideOut
        delta={open}
        labels={labels}
        onClose={() => setOpenRepo(null)}
        onResolve={open && onResolveDelta ? () => onResolveDelta(resolveDirectiveText(labels, open as RunDelta)) : undefined}
        onCopyDiagnostics={open ? () => {
          const text = runDeltaDiagnosticsText(labels, open as RunDelta, new Date().toISOString());
          setLastCopied({ text, key: openRepo ?? '' });
          void copier.copy(text);
        } : undefined}
      />
    </div>
  );
}
