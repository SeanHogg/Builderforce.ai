import { useEffect, useState } from 'react';
import { clearActiveCanvasSync, setActiveCanvasSync } from '@/lib/activeCanvasSyncStatus';

export type CanvasRealtimeState = 'local' | 'connecting' | 'online' | 'reconnecting' | 'offline';

/**
 * Whether the board is still loading, and the state of its live connection — PUBLISHED for
 * the session rail, which lives outside the canvas's tree (a sibling in the app shell, not
 * a child) and so cannot read this state as a prop. A local-only board has no connection to
 * report, so it publishes nothing rather than a fifth state the rail would have to invent
 * a label for.
 */
export function useCanvasRealtimeState(sessionId: string, persistence: 'local' | 'server') {
  const [loadingSession, setLoadingSession] = useState(persistence === 'server');
  const [realtimeState, setRealtimeState] = useState<CanvasRealtimeState>(persistence === 'local' ? 'local' : 'connecting');
  useEffect(() => {
    setActiveCanvasSync(sessionId, realtimeState === 'local' ? undefined : realtimeState);
  }, [sessionId, realtimeState]);
  useEffect(() => () => clearActiveCanvasSync(sessionId), [sessionId]);
  return { loadingSession, setLoadingSession, realtimeState, setRealtimeState };
}
