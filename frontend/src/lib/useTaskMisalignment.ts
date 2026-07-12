/**
 * useTaskMisalignment Custom Hook
 * Provides easy access to task misalignment state with automatic polling
 */

import { useCallback, useEffect, useState } from 'react';
import { TaskMisalignmentState, type MisalignmentCheck } from '@/lib/priorityMisalignmentApi';
import { getTaskMisalignmentState } from '@/lib/priorityMisalignmentApi';

export interface MisalignmentState {
  checks: MisalignmentCheck[];
  severity: 'warning' | 'error';
  timestamp: number;
}

/**
 * Custom hook to fetch and manage task misalignment state
 * Automatically polls for updates every 30 seconds
 * Falls back silently if API is unavailable
 */
export function useTaskMisalignment(taskId: number): MisalignmentState {
  const [state, setState] = useState<MisalignmentState>({
    checks: [],
    severity: 'warning',
    timestamp: 0,
  });

  const fetchState = useCallback(async () => {
    try {
      const data = await getTaskMisalignmentState(taskId);
      setState({
        checks: data.issues || [],
        severity: data.totalSeverity || 'warning',
        timestamp: Date.now(),
      });
    } catch (e) {
      console.warn(`Failed to fetch misalignment state for task ${taskId}`, e);
      // Silently fail on error, keep previous state
    }
  }, [taskId]);

  useEffect(() => {
    // Initial fetch on mount
    fetchState();

    // Poll for updates every 30 seconds
    const intervalId = setInterval(fetchState, 30000);

    return () => clearInterval(intervalId);
  }, [fetchState]);

  return state;
}

/**
 * Manual trigger to refresh misalignment state
 */
export function refreshMisalignmentState(taskId: number): Promise<TaskMisalignmentState> {
  return getTaskMisalignmentState(taskId);
}

/**
 * Custom hook to fetch misalignment state immediately (without polling)
 */
export function useImmediateMisalignmentState(taskId: number): {
  checks: MisalignmentCheck[];
  severity: 'warning' | 'error';
  loading: boolean;
} {
  const [state, setState] = useState<{
    checks: MisalignmentCheck[];
    severity: 'warning' | 'error';
    loading: boolean;
  }>({
    checks: [],
    severity: 'warning',
    loading: true,
  });

  useEffect(() => {
    setState((prev) => ({ ...prev, loading: true }));
    getTaskMisalignmentState(taskId)
      .then((data) => {
        setState({
          checks: data.issues || [],
          severity: data.totalSeverity || 'warning',
          loading: false,
        });
      })
      .catch((e) => {
        console.warn(`Failed to fetch misalignment state for task ${taskId}`, e);
        setState((prev) => ({ ...prev, loading: false }));
      });
  }, [taskId]);

  return state;
}