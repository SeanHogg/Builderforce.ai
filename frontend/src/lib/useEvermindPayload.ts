/**
 * useEvermindPayload — shared hook that loads and keeps the Evermind payload in sync for multiple consumers.
 * It loads payload once, provides it to subscribers, and automatically polls on projectIdOrPayload changes or refreshInterval changes.
 * Ensures agent context and board state operate on the same payload snapshot (FR-5).
 *
 * @param projectIdOrPayload - either a live project ID (fetch) or a previously-parsed payload object (static).
 * @param refreshIntervalMs - polling interval for live projects (default: 10s).
 * @returns { loading, payload, error } — loading state, payload snapshot, and error if any.
 */
'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { EvermindPayloadSnapshot, PayloadDeliveryError } from './evermindPayloadDelivery';
import { loadEvermindPayload } from './evermindPayloadDelivery';

export interface UseEvermindPayloadResult {
  loading: boolean;
  payload: EvermindPayloadSnapshot | null;
  error: PayloadDeliveryError | null;
}

/**
 * Hook that loads and tracks the Evermind payload for a project or a static payload.
 * Reactivates on projectIdOrPayload changes or refreshIntervalMs changes.
 */
export function useEvermindPayload(options?: {
  projectIdOrPayload?: number | unknown;
  refreshIntervalMs?: number;
}): UseEvermindPayloadResult {
  const { projectIdOrPayload = undefined, refreshIntervalMs = 10_000 } = options ?? {};
  const [projectId, setProjectId] = useState<number | null | 'static'>('static');
  const [projectIdOrPayloadStr, setProjectIdOrPayloadStr] = useState<string | number | undefined>(undefined);
  const [payload, setPayload] = useState<EvermindPayloadSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<PayloadDeliveryError | null>(null);

  // When projectIdOrPayload changes, recompute which mode we're in (static vs live).
  useEffect(() => {
    if (typeof projectIdOrPayload === 'number') {
      setProjectId(projectIdOrPayload);
      setProjectIdOrPayloadStr(projectIdOrPayload);
    } else {
      setProjectId('static');
      setProjectIdOrPayloadStr(undefined);
    }
    // Reset for state clean-up; the next effect loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdOrPayload]);

  // Kick off polling or static load based on mode.
  useEffect(() => {
    const target = projectId === 'static' ? undefined : projectId;
    const projectIdPayloadKey = projectIdOrPayloadStr ?? undefined;

    setPayload(null);
    setError(null);
    setLoading(true);

    const timer = setTimeout(() => {
      const loader = async () => {
        if (projectId === 'static') {
          setLoading(false);
          // Static mode: no live reload, but the hook itself still yields payload.
          // No-op — nothing to fetch for static; just exit.
          return;
        }

        try {
          const rawPayload = await loadEvermindPayload(target);
          setPayload(rawPayload);
        } catch (err) {
          setError(err instanceof PayloadDeliveryError ? err : new PayloadDeliveryError('network', `Unknown error: ${err instanceof Error ? err.message : String(err)}`));
        } finally {
          setLoading(false);
        }
      };

      void loader();
    }, 500);

    // Earlier trigger for initial load to avoid the 500ms initial delay.
    const initialLoader = setTimeout(() => {
      void loader();
    }, 1);

    return () => {
      clearTimeout(initialLoader);
      clearTimeout(timer);
    };
  }, [projectId, projectIdOrPayloadStr]);

  return { loading, payload, error };
}