'use client';

import { useCallback, useState } from 'react';
import { importRows, type ImportResult } from './importApi';
import { toImportRow } from './importHelpers';

/**
 * The guided wizard's submit: ONE record → `POST /api/import/:kind` → the
 * server's verdict. The wizard renders `result` (what was written, or why it
 * was skipped) and never invents a reference of its own — the server's count is
 * the receipt.
 */
export interface GuidedImportSubmit {
  submit: (record: Record<string, string>) => Promise<ImportResult | null>;
  submitting: boolean;
  result: ImportResult | null;
  /** The request itself failed (network, auth) — distinct from a row the
   *  server read and declined, which comes back as a `result`. */
  failed: boolean;
  reset: () => void;
}

export function useGuidedImportSubmit(kind: string): GuidedImportSubmit {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [failed, setFailed] = useState(false);

  const submit = useCallback(async (record: Record<string, string>): Promise<ImportResult | null> => {
    setSubmitting(true);
    setFailed(false);
    try {
      const next = await importRows(kind, [toImportRow(record)]);
      setResult(next);
      return next;
    } catch {
      setFailed(true);
      return null;
    } finally {
      setSubmitting(false);
    }
  }, [kind]);

  const reset = useCallback(() => {
    setResult(null);
    setFailed(false);
  }, []);

  return { submit, submitting, result, failed, reset };
}
