// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useEffect, useState } from 'react';
import { subscribeWorkspaceFiles } from '@/lib/workspaceFileEvents';
import type { WorkspaceId } from '@/lib/workspace/workspaceId';

/** How often "updated 12s ago" re-reads the clock. */
const TICK_MS = 15_000;

/**
 * When the preview last changed: the moment it went live, then every time the
 * project's files change while it is live (hot reload carries those edits into
 * the running app). Returns that time and a clock that ticks, so the address
 * bar's "updated 12s ago" stays true without anyone pressing reload.
 */
export function usePreviewFreshness(projectId: WorkspaceId, url: string | undefined): { updatedAt: number | null; now: number } {
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUpdatedAt(url ? Date.now() : null);
  }, [url]);

  useEffect(() => {
    if (!url) return undefined;
    return subscribeWorkspaceFiles((changed) => {
      if (changed === projectId) setUpdatedAt(Date.now());
    });
  }, [projectId, url]);

  useEffect(() => {
    if (updatedAt == null) return undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [updatedAt]);

  return { updatedAt, now };
}
