'use client';

import { useEffect } from 'react';
import { onBrainDataChanged, type BrainDataChangedEvent } from './brainDataEvent';

/**
 * Subscribe a data view to Brain-driven writes so it refetches LIVE instead of
 * going stale until a manual reload.
 *
 * When the Brain (the global floating drawer / `/brainstorm`) runs a mutating
 * platform capability, the write hits the API but the page *showing* that data
 * holds its own React state and has no idea. This hook is the canonical one-line
 * wiring every list view uses — pass the capability `domains` you render and the
 * view's `reload` callback. It mirrors the inline effect `TaskMgmtContent`
 * already had, extracted so every other view (Projects, Specs, Workflows,
 * Workforce, Boards, Prompts) wires it identically rather than re-inlining the
 * `useEffect(() => onBrainDataChanged(...), [reload])` boilerplate.
 *
 * `reload` should be stable (wrap it in `useCallback`); the effect re-subscribes
 * whenever it changes, exactly like the original inline version.
 */
export function useBrainDataRefresh(
  domains: string[],
  reload: (event: BrainDataChangedEvent) => void,
): void {
  useEffect(
    () => onBrainDataChanged(domains, reload),
    // domains is a literal array per call site; spread it so a new array
    // identity each render doesn't force a re-subscribe — only its contents do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reload, ...domains],
  );
}
