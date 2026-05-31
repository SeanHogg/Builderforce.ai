'use client';

/**
 * Ambient page context for the Brain.
 *
 * The Brain is mounted once, app-wide, but its behaviour depends on what the
 * user is looking at: which project, which modality, and any extra system
 * context (e.g. the file currently open in an IDE). Pages publish that context
 * here via `setContext(...)`; the Brain reads it. This keeps the Brain decoupled
 * from any single page — no prop-drilling through the app shell.
 *
 * Separate from `BrainActionsContext` (which holds executable tools) on purpose:
 * this is passive context data, not executable capability.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { BrainModality } from './types';

export interface BrainPageContext {
  /** Active project, when the current page is project-scoped (IDE, project pages). */
  projectId: number | null;
  /** Active modality — drives the Brain's system prompt/persona. */
  modality: BrainModality;
  /** Extra system-prompt context appended for this page (e.g. the open file + content). */
  extraSystem?: string;
  /** Deep-link: open the drawer on this chat. */
  initialChatId?: number | null;
}

export interface BrainContextValue extends BrainPageContext {
  open: boolean;
  setOpen(open: boolean): void;
  /** Merge partial page context (call from a page effect). */
  setContext(patch: Partial<BrainPageContext>): void;
}

const DEFAULT_CONTEXT: BrainPageContext = {
  projectId: null,
  modality: 'designer',
  extraSystem: undefined,
  initialChatId: null,
};

const BrainContext = createContext<BrainContextValue | null>(null);

export function BrainContextProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pageContext, setPageContext] = useState<BrainPageContext>(DEFAULT_CONTEXT);

  const setContext = useCallback((patch: Partial<BrainPageContext>) => {
    setPageContext((prev) => {
      // Avoid a state churn loop when a page re-publishes identical context.
      const next = { ...prev, ...patch };
      if (
        next.projectId === prev.projectId &&
        next.modality === prev.modality &&
        next.extraSystem === prev.extraSystem &&
        next.initialChatId === prev.initialChatId
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const value = useMemo<BrainContextValue>(
    () => ({ ...pageContext, open, setOpen, setContext }),
    [pageContext, open, setContext],
  );

  return <BrainContext.Provider value={value}>{children}</BrainContext.Provider>;
}

/** Read/update the ambient Brain context. Throws if no provider is mounted. */
export function useBrainContext(): BrainContextValue {
  const ctx = useContext(BrainContext);
  if (!ctx) throw new Error('useBrainContext must be used within a BrainContextProvider');
  return ctx;
}

/**
 * Safe variant for pages that may render with or without the Brain mounted.
 * Returns null instead of throwing when no provider is present.
 */
export function useOptionalBrainContext(): BrainContextValue | null {
  return useContext(BrainContext);
}
