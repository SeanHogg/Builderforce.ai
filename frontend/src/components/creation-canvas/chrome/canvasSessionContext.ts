import { createContext, useContext } from 'react';
import type { CreationSessionSummary } from '@/lib/builderforceApi';
import type { useCanvasAccountGate } from '../hooks/useCanvasAccountGate';

/**
 * WHO AND WHAT THIS SESSION IS — the handful of facts every piece of chrome and every
 * stage panel asks before it draws a control: which session, where it lives, what this
 * viewer may do to it, how to say something in the pill, and how to ask for the account
 * an action needs.
 *
 * ONE concern, published once by `CanvasInner`. It is deliberately not the board (nodes,
 * edges, selection) and not the Brain run: those change on every edit and every streamed
 * token, and a context that carried them would re-render every consumer on every one.
 * These six change when the session itself changes — practically never.
 */
export interface CanvasSessionFacts {
  sessionId: string;
  persistence: 'local' | 'server';
  role: CreationSessionSummary['role'];
  /** The viewer's ROLE allows editing. Not the object lock — that is per selection. */
  canEdit: boolean;
  /** The pill's status line — the outcome of what the user just did. */
  notify: (text: string) => void;
  /** Open the account gate for an action that needs a saved session. */
  requireAccount: ReturnType<typeof useCanvasAccountGate>['requireAccount'];
}

const CanvasSessionContext = createContext<CanvasSessionFacts | null>(null);

export const CanvasSessionProvider = CanvasSessionContext.Provider;

export function useCanvasSessionFacts(): CanvasSessionFacts {
  const value = useContext(CanvasSessionContext);
  if (!value) throw new Error('useCanvasSessionFacts must be read inside CanvasSessionProvider');
  return value;
}
