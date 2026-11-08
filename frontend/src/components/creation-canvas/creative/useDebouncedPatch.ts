import { useCallback, useEffect, useRef } from 'react';

/**
 * Collects rapid edits into ONE write. The editors persist their whole document on each
 * `onEdit`, so a keystroke or a slider tick must not be a write of its own: patches merge
 * while the person keeps going, and the merged patch is committed `delay` ms after the
 * last one, on `flush()` (blur, pointer-up) and when the component unmounts.
 */
export function useDebouncedPatch<Patch extends object>(commit: (patch: Patch) => void, delay = 400) {
  const commitRef = useRef(commit);
  useEffect(() => { commitRef.current = commit; });
  const pending = useRef<Patch | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = null;
    if (patch) commitRef.current(patch);
  }, []);

  const schedule = useCallback((patch: Patch) => {
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  }, [delay, flush]);

  const isPending = useCallback(() => pending.current !== null, []);
  useEffect(() => flush, [flush]);
  return { schedule, flush, isPending };
}
