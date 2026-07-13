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
  EvermindEvent,
  EventPayloadDelivery,
  EventPayloadValidation,
  EventAgentContext,
  EVERMIND_POLL_INTERVAL_MS,
  EVERMIND_CLIENT_ERROR_LOAD_DELAY_MS,
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
    refetchIntervalMs = EVERMIND_POLL_INTERVAL_MS, 
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

  // Import here to avoid circular dependency with events
  const { loadEvermindPayload, agentContextFromPayload } = (() => {
    // Dynamic import to avoid circular dependencies
    try {
      const deliveryModule = require('./evermindPayloadDelivery');
      return {
        loadEvermindPayload: deliveryModule.loadEvermindPayload,
        agentContextFromPayload: deliveryModule.agentContextFromPayload,
      };
    } catch (e) {
      console.error('[useEvermindPayload] Failed to load delivery module:', e);
      return {
        loadEvermindPayload: () => Promise.reject(new Error('Module not loaded')),
        agentContextFromPayload: () => null,
      };
    }
  })();

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
        
        // Log delivery success
        const deliveryEvent: EventPayloadDelivery = {
          type: 'payload_delivery',
          timestamp: new Date().toISOString(),
          eventId: `ev-${now}`,
          projectId,
          payloadId: result.snapshot.payloadId,
          status: 'success',
          payloadVersion: result.snapshot.payloadVersion,
          lastWinningAt: result.snapshot.lastWinningAt
        };
        console.log('[useEvermindPayload]', deliveryEvent);
        
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
        if (snapshot) {
          setError(validationError);
          setValidity('invalid');
          
          const validationEvent: EventPayloadValidation = {
            type: 'payload_validation',
            timestamp: new Date().toISOString(),
            eventId: `ev-${Date.now()}`,
            projectId,
            payloadId: result.snapshot.payloadId,
            status: 'failed',
            level: 'warning',
            payloadVersion: result.snapshot.payloadVersion,
            errors: result.errors,
          };
          console.log('[useEvermindPayload]', validationEvent);
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
      
      const validationEvent: EventPayloadValidation = {
        type: 'payload_validation',
        timestamp: new Date().toISOString(),
        eventId: `ev-${Date.now()}`,
        projectId,
        payloadId: lastValidSnapshot?.payloadId || 'unknown',
        status: 'failed',
        level: 'error',
        payloadVersion: lastValidSnapshot?.payloadVersion || 'unknown',
        errors: [{ message: payloadError.message }]
      };
      console.log('[useEvermindPayload]', validationEvent);
    }
    
    setLoading(false);
  }, [enabled, projectId, lastValidSnapshot]);

  // Initial load
  useEffect(() => {
    fetchPayload();
  }, [fetchPayload]);

  // Polling logic
  useEffect(() => {
    if (!enabled) return;

    // Debounce polling around client errors
    const intervalMs = error && error.severity === 'validation' 
      ? EVERMIND_CLIENT_ERROR_LOAD_DELAY_MS 
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