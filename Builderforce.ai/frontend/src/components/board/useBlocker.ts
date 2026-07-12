'use client';

import type { BoardCardProps } from './__generated';

/**
 * useBlocker - React hook for managing blocked task state.
 *
 * Provides methods to toggle blocked status and update blocker reason for a task.
 * This hook can be used by board/list/detail view components to handle blocked state.
 */

interface BlockerContextValue {
  /** Is the task blocked? */
  isBlocked: boolean;
  /** The blocker reason text (max 255 characters) */
  blockerReason?: string;

  /** Callback to toggle blocked status */
  toggleBlocked: () => void;
  /** Callback to update blocker reason */
  updateReason: (reason: string) => void;
  /** Callback to clear blocker data */
  clearBlocker: () => void;
}

type BlockerContext = React.Context<BlockerContextValue | undefined>;

const BlockerContext: BlockerContext = React.createContext<BlockerContextValue | undefined>(undefined);

export function BlockerProvider({ children, initialValue }: { children: React.ReactNode; initialValue: BlockerContextValue }) {
  return <BlockerContext.Provider value={initialValue}>{children}</BlockerContext.Provider>;
}

export function useBlocker(): BlockerContextValue {
  const context = React.useContext(BlockerContext);
  if (context === undefined) {
    throw new Error('useBlocker must be used within a BlockerProvider');
  }
  return context;
}

/**
 * getDefaultBlockerReasonUpdater - Utility to create an onUpdate callback
 * for BlockerDrawer and related components using useBlocker hook values.
 *
 * @param onToggleBlocked - Callback when blocked status changes
 * @returns Function to update blocker reason
 */
export function getDefaultBlockerReasonUpdater(
  onToggleBlocked: () => void,
): (newReason: string) => void {
  return (newReason: string) => {
    onToggleBlocked();

    let reason: string | null = null;
    if (newReason.trim().length > 0) {
      reason = newReason.trim().slice(0, 255);
    }

    onToggleBlocked?.();
    // The actual task update happens in the parent component via useBlocker
  };
}

export { BlockerContext };