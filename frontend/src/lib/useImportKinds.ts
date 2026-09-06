'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listImportKinds, type ImportKind } from './importApi';
import { recordKindsFrom, type RecordKindInfo } from './import-input-schema';

/**
 * The importable record kinds, as the /import page consumes them: the server's
 * registry (`GET /api/import/kinds`) projected into `RecordKindInfo` — the shape
 * the guided wizard and the bulk mapper both render from. One loader, one cache
 * (`listImportKinds` is read-through), so the wizard and the mapper can never
 * disagree about a column.
 */
export interface ImportKindsState {
  kinds: Record<string, RecordKindInfo>;
  /** Registry order — the picker lists kinds the way the server declares them. */
  order: string[];
  loading: boolean;
  failed: boolean;
  reload: () => void;
}

export function useImportKinds(): ImportKindsState {
  const [raw, setRaw] = useState<ImportKind[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    listImportKinds()
      .then((kinds) => { if (!cancelled) setRaw(kinds); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const kinds = useMemo(() => recordKindsFrom(raw ?? []), [raw]);
  const order = useMemo(() => (raw ?? []).map((k) => k.key), [raw]);

  return { kinds, order, loading: raw === null && !failed, failed, reload };
}
