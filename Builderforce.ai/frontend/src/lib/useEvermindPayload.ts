/**
 * useEvermindPayload — Shared React Hook
 * 
 * Loads and polls Evermind payload from the server, producing a consistent snapshot
 * for multiple active contexts (agent reasoning, board display, etc.).
 * 
 * Design goals:
 * - Single source of truth: same snapshot returned to all consumers
 * - Reactive updates: triggers re-renders when payload changes
 * - Consistent state: loading/error/ready states match between consumers
 * - Observability: logs events for discovery and debugging (FR-6)
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  EvermindPayloadSnapshot, 
  PayloadDeliveryError, 
  ValidatedPayload,
  AgentContext,
  EventPayloadDelivery,
  EventPayloadValidation,
  EVENMIND_POLL_INTERVAL_MS,
} from './types';

// === Hook Props ===

export interface UseEvermindPayloadProps {
  projectId: number;
  refetchIntervalMs?: number;
  enabled?: boolean;
}

// === Hook Return ===

export interface UseEvermindPayloadReturn {
  snapshot: EvermindPayloadSnapshot | null;
  error: PayloadDeliveryError | null;
  loading: boolean;
  validity: 'valid' | 'invalid' | 'unknown';
  agentContext: AgentContext | null;
  isError: boolean;
  refetch: () => Promise<void>;
}

// === Hook ===

export function useEvermindPayload(props: UseEvermindPayloadProps): UseEvermindPayloadReturn {
  const { 
    projectId, 
    refetchIntervalMs = 10000, // 10s default
    enabled = true 
  } = props;

  const [snapshot, setSnapshot] = useState<EvermindPayloadSnapshot | null>(null);
  const [error, setError] = useState<PayloadDeliveryError | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Validity state tracks whether the payload passed validation
  const [validity, setValidity] = useState<'valid' | 'invalid' | 'unknown'>('unknown');
  
  // Refs to track changes and prevent double-fetches
  const lastPollTriggeredAt = useRef(0);
  const wasLoadingRef = useRef(false);
  const lastValidSnapshotRef = useRef<EvermindPayloadSnapshot | null>(null);

  // Import here to avoid circular dependency
  let loadEvermindPayload, agentContextFromPayload;
  try {
    const deliveryModule = require('./evermindPayloadDelivery');
    loadEvermindPayload = deliveryModule.loadEvermindPayload;
    agentContextFromPayload = deliveryModule.agentContextFromPayload;
  } catch (e) {
    console.error('[useEvermindPayload] Failed to load delivery module:', e);
    loadEvermindPayload = () => Promise.reject(new Error('Module not loaded'));
    agentContextFromPayload = () => null;
  }

  // Core loading function
  const fetchPayload = useCallback(async (): Promise<void> => {
    if (!enabled) {
      console.log('[useEvermindPayload] Fetch disabled');
      return;
    }

    const now = Date.now();
    console.log(`[useEvermindPayload] Fetching payload for project ${projectId} (last polled: ${new Date(lastPollTriggeredAt.current).toISOString()})`);

    setLoading(true);
    setError(null);
    wasLoadingRef.current = true;

    try {
      const result = await loadEvermindPayload(projectId);

      // Update state with result
      if (result.validity === 'valid') {
        setSnapshot(result.snapshot);
        setError(null);
        setValidity('valid');
        lastValidSnapshotRef.current = result.snapshot;
        
        // Log delivery success
        console.log('[useEvermindPayload] Payload delivery successful', {
          timestamp: new Date().toISOString(),
          eventId: `ev-${now}`,
          projectId,
          payloadId: result.snapshot.payloadId,
          status: 'success',
          payloadVersion: result.snapshot.payloadVersion,
          lastWinningAt: result.snapshot.lastWinningAt
        });
        
        wasLoadingRef.current = false;
        return;
      } else if (result.validity === 'invalid') {
        // Create validation error
        const validationError = new PayloadDeliveryError(
          `Payload validation failed for payload ${result.snapshot.payloadId}`,
          'validation',
          { errors: result.errors }
        );
        
        // In board use case, we show last valid snapshot if available
        // In agent use case, we reject to halt reasoning (FR-1.3, FR-4.3)
        if (lastValidSnapshotRef.current) {
          setSnapshot(lastValidSnapshotRef.current);
          setError(validationError);
          setValidity('invalid');
          
          console.log('[useEvermindPayload] Payload validation failed', {
            timestamp: new Date().toISOString(),
            eventId: `ev-${Date.now()}`,
            projectId,
            payloadId: result.snapshot.payloadId,
            status: 'failed',
            level: 'warning',
            payloadVersion: result.snapshot.payloadVersion,
            errors: result.errors
          });
        }
        
        // Agent consumption: halt reasoning if payload is invalid
        throw validationError;
      }
    } catch (err) {
      const payloadError = err instanceof PayloadDeliveryError ? err : 
        new PayloadDeliveryError(
          err instanceof Error ? err.message : 'Unknown error loading payload',
          'network',
          err
        );
      
      setError(payloadError);
      setValidity('unknown');
      wasLoadingRef.current = false;
      
      const lastValidSnapshot = lastValidSnapshotRef.current;
      console.log('[useEvermindPayload] Payload fetch error', {
        timestamp: new Date().toISOString(),
        eventId: `ev-${Date.now()}`,
        projectId,
        payloadId: lastValidSnapshot?.payloadId || 'unknown',
        status: 'failed',
        level: 'error',
        payloadVersion: lastValidSnapshot?.payloadVersion || 'unknown',
        error: payloadError.message
      });
    }
    
    setLoading(false);
  }, [enabled, projectId]);

  // Initial load
  useEffect(() => {
    fetchPayload();
  }, [fetchPayload]);

  // Polling logic
  useEffect(() => {
    if (!enabled) return;

    const intervalMs = error && error.severity === 'validation' 
      ? 500 // 500ms debounce for validation errors
      : refetchIntervalMs;

    const timer = setInterval(fetchPayload, intervalMs);
    
    return () => {
      clearInterval(timer);
    };
  }, [enabled, error, refetchIntervalMs, fetchPayload]);

  // Computed agent context
  const agentContext = useMemo(() => {
    if (!snapshot || validity !== 'valid') {
      return null;
    }
    return agentContextFromPayload(snapshot, projectId);
  }, [snapshot, validity, projectId]);

  return {
    snapshot,
    error,
    loading,
    validity,
    agentContext,
    isError: error !== null && error.severity === 'network',
    refetch,
  };
}