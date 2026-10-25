import { useEffect, useState } from 'react';
import { request } from '../bridgeTransport';
import { onPendingChanges } from '../bridgeState';

/**
 * The working tree's unified diff, from the host (`changes.diff` → `detectPendingDiff`).
 *
 * The change tree drew every file with "No diff to show" because nothing ever sent it
 * text: the host pushes file LISTS (`pendingChanges`), never content. The diff is
 * re-asked on every list push — a write, a stage, a checkout — so the rows track the
 * same working tree the list does. A failed ask keeps the last diff rather than
 * blanking the rows mid-run.
 */
export function usePendingDiff(): string {
  const [diff, setDiff] = useState('');
  useEffect(() => {
    let live = true;
    const ask = (): void => {
      request<string>('changes.diff')
        .then((text) => { if (live) setDiff(typeof text === 'string' ? text : ''); })
        .catch(() => { /* keep the last diff */ });
    };
    ask();
    const off = onPendingChanges(ask);
    return () => { live = false; off(); };
  }, []);
  return diff;
}
