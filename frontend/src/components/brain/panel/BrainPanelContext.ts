import { createContext, useContext } from 'react';
import type { BrainPanelController } from '../hooks/useBrainPanelController';

/**
 * The ONE Brain panel's controller, shared with its sections so none of them is
 * handed a fan of props it could read itself. Provided only by `BrainPanel`.
 */
export const BrainPanelContext = createContext<BrainPanelController | null>(null);

export function useBrainPanel(): BrainPanelController {
  const ctx = useContext(BrainPanelContext);
  if (!ctx) throw new Error('useBrainPanel must be used inside <BrainPanel>');
  return ctx;
}
