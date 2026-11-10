'use client';

/**
 * A project's Run deltas (PRD 41 §C11.3): the trend of its agent runs (verdict by dimension, blast radius score) and the
 * run list, newest first, each row opening that run's delta in the slide-out panel. The ONE `RunDeltaHistory` view the
 * VS Code panel renders too, fed here by `GET /api/projects/:id/run-deltas` (paged) through the typed client.
 *
 * Self-contained, and silent where it does not apply: not entitled, an unknown project or a signed-out reader renders
 * nothing. A project with no deltas yet shows the empty state (what will appear here, and when).
 *
 * Every read is cancellable and owned: a new page read aborts the one in flight, a new selection aborts the previous one
 * (a late answer for an older row never opens), and a different project starts over. A failed "show older runs" keeps the
 * rows already shown and retries that same page.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { RunDeltaHistory, summaryKey } from '@builderforce/knowledge-graph-view';
import type { RunDelta } from '@builderforce/run-delta';
import { useFormat } from '@/i18n/useFormat';
import { getRunDeltas, isRunDeltaUnavailable, listProjectRunDeltas, type RunDeltaSummary } from '@/lib/runDeltasApi';
import { useRunDeltaLabels } from '@/lib/knowledge/runDeltaLabels';
import { RunDeltaSlideOut } from './RunDeltaSlideOut';

const PAGE = 50;

/** What the last page read was: the cursor it asked for (undefined = the first page) and whether it failed. */
interface PageState {
  loading: boolean;
  failed: boolean;
  /** The cursor of the read that failed, so its retry asks for the same page. */
  failedCursor: string | undefined;
}

const IDLE: PageState = { loading: false, failed: false, failedCursor: undefined };

export function ProjectRunDeltas({ projectId }: { projectId: number }) {
  const { labels, historyLabels } = useRunDeltaLabels();
  const fmt = useFormat();
  const [items, setItems] = useState<RunDeltaSummary[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [page, setPage] = useState<PageState>({ ...IDLE, loading: true });
  const [unavailable, setUnavailable] = useState(false);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<RunDelta | null>(null);
  const [openError, setOpenError] = useState(false);
  const pageRead = useRef<AbortController | null>(null);
  const selectRead = useRef<AbortController | null>(null);

  const loadPage = useCallback(async (after?: string) => {
    pageRead.current?.abort();
    const controller = new AbortController();
    pageRead.current = controller;
    setPage({ ...IDLE, loading: true });
    try {
      const next = await listProjectRunDeltas(projectId, { limit: PAGE, ...(after ? { cursor: after } : {}), signal: controller.signal });
      if (controller.signal.aborted) return;
      setItems((current) => (after ? [...current, ...next.items] : next.items));
      setCursor(next.nextCursor);
      setPage(IDLE);
    } catch (e) {
      if (controller.signal.aborted) return;
      if (isRunDeltaUnavailable(e)) { setUnavailable(true); setPage(IDLE); return; }
      setPage({ loading: false, failed: true, failedCursor: after });
    }
  }, [projectId]);

  // A different project starts over: no rows, no cursor, nothing open, no read of the previous project left running.
  useEffect(() => {
    setItems([]);
    setCursor(undefined);
    setUnavailable(false);
    setSelected(undefined);
    setOpen(null);
    setOpenError(false);
    void loadPage();
    return () => {
      pageRead.current?.abort();
      selectRead.current?.abort();
    };
  }, [loadPage]);

  const select = useCallback(async (item: RunDeltaSummary) => {
    selectRead.current?.abort();
    const controller = new AbortController();
    selectRead.current = controller;
    setSelected(summaryKey(item));
    setOpenError(false);
    try {
      const deltas = await getRunDeltas(item.runId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const match = deltas.find((d) => d.repoKey === item.repoKey) ?? deltas[0];
      setOpen(match?.delta ?? null);
      if (!match) setOpenError(true);
    } catch (e) {
      if (controller.signal.aborted) return;
      setOpen(null);
      // "Not available" is not a fault to report (the row's delta is gone or not this reader's); anything else is.
      setOpenError(!isRunDeltaUnavailable(e));
    }
  }, []);

  const close = useCallback(() => {
    selectRead.current?.abort();
    setOpen(null);
    setSelected(undefined);
    setOpenError(false);
  }, []);

  if (unavailable) return null;
  return (
    <>
      <RunDeltaHistory
        items={items}
        labels={labels}
        historyLabels={historyLabels}
        formatTime={(iso) => fmt.dateTime(iso)}
        formatNumber={(n) => fmt.number(n, { maximumFractionDigits: 2 })}
        loading={page.loading}
        error={page.failed}
        onRetry={() => void loadPage(page.failedCursor)}
        hasMore={!!cursor}
        onLoadMore={() => void loadPage(cursor)}
        onSelect={(item) => void select(item)}
        selectedKey={open ? selected : undefined}
        openError={openError}
      />
      <RunDeltaSlideOut delta={open} labels={labels} onClose={close} />
    </>
  );
}
