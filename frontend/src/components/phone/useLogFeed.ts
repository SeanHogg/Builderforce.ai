'use client';

import { useEffect, useState } from 'react';
import { usePhone } from '@/lib/usePhone';

/**
 * "Load a log, and reload it when the phone state moves."
 *
 * The message log, the call log and the statement are three different shapes with
 * one identical lifecycle: fetch on mount, refetch after any write, keep an error
 * without blanking the rows already on screen. Written three times that lifecycle
 * would be three places for the refetch to be forgotten — and the symptom is a
 * message that sends successfully and does not appear, which reads as a bug in
 * sending.
 *
 * The refresh signal is the shared snapshot's identity: every write calls
 * `usePhone().refresh()`, which replaces the overview object, which re-runs this.
 * So one invalidation moves the balance, the numbers AND all three logs, and no
 * component has to know about the others.
 *
 * Rows survive a failed reload on purpose. A transient error should not empty a
 * list somebody is reading; the error is shown beside the stale rows instead.
 */
export function useLogFeed<T>(load: () => Promise<T[]>): { rows: T[]; error: string } {
  const { overview } = usePhone();
  const [rows, setRows] = useState<T[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!overview) return;
    let active = true;
    load()
      .then((next) => { if (active) { setRows(next); setError(''); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
    // `load` is a module-level function in every call site, so it is stable; the
    // snapshot identity is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview]);

  return { rows, error };
}
