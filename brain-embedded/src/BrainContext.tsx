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

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { BrainModality } from './types';

// Persist the drawer's open state + active chat for the tab session, so the
// Brain survives navigation that remounts this provider — a hard reload, an
// external-entry deep link, or any in-app link that isn't a client-side
// router.push. (Client-side nav keeps the provider mounted, so this is a
// safety net, not the primary path.) sessionStorage = per-tab: a brand-new
// tab starts with the drawer closed, but it stays put as the user moves around.
const OPEN_KEY = 'brain.drawer.open';
const CHAT_KEY = 'brain.drawer.activeChatId';

function readSession(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}
function writeSession(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value == null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch { /* storage disabled (private mode / quota) — non-fatal */ }
}

export interface BrainPageContext {
  /**
   * Active project, when the current page PINS the Brain to one project (the
   * IDE). Pinning also switches the docked Brain to that project's modality
   * coding persona and scopes its chats — so non-IDE pages that merely want the
   * Brain to be *aware* of the project they're viewing should set
   * `viewingProjectId` instead (it keeps the platform co-pilot persona).
   */
  projectId: number | null;
  /**
   * The project the user is currently looking at (e.g. the Tasks board scoped to
   * `?project=14`). Unlike `projectId`, this does NOT change the persona or pin
   * chats — it only tells the Brain to use this project as the default for
   * project-scoped actions when the user doesn't name one.
   */
  viewingProjectId: number | null;
  /** Active modality — drives the Brain's system prompt/persona. */
  modality: BrainModality;
  /** Extra system-prompt context appended for this page (e.g. the open file + content). */
  extraSystem?: string;
  /** Deep-link: open the drawer on this chat. */
  initialChatId?: number | null;
  /** Deep-link: one-shot prompt auto-sent when the drawer opens (e.g. the IDE
   *  `?prompt=` seed). Distinct from a pending-prompt handoff — this is published
   *  by a page effect, not read from storage. */
  initialPrompt?: string;
  /** Deep-link: one-shot work item to auto-link the opened chat to (the IDE
   *  `?ticket=<kind>:<ref>` seed). The docked Brain gets this as a direct prop; the
   *  floating drawer reads it here. */
  initialTicket?: { kind: string; ref: string };
}

export interface BrainContextValue extends BrainPageContext {
  open: boolean;
  setOpen(open: boolean): void;
  /** Merge partial page context (call from a page effect). */
  setContext(patch: Partial<BrainPageContext>): void;
  /**
   * The chat currently selected in the docked Brain. Lifted here so co-mounted
   * Brain instances (e.g. the IDE Designer left-panel and the floating drawer)
   * stay on the same conversation. Distinct from `initialChatId` (a one-shot
   * deep-link); this tracks the live selection.
   */
  activeChatId: number | null;
  setActiveChatId(id: number | null): void;
}

const DEFAULT_CONTEXT: BrainPageContext = {
  projectId: null,
  viewingProjectId: null,
  modality: 'designer',
  extraSystem: undefined,
  initialChatId: null,
};

const BrainContext = createContext<BrainContextValue | null>(null);

export function BrainContextProvider({ children }: { children: React.ReactNode }) {
  // Start closed on both server and first client render to avoid a hydration
  // mismatch; rehydrate the persisted open state + active chat on mount, so a
  // navigation that remounted this provider reopens the drawer on its chat.
  const [open, setOpen] = useState(false);
  const [pageContext, setPageContext] = useState<BrainPageContext>(DEFAULT_CONTEXT);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);

  useEffect(() => {
    if (readSession(OPEN_KEY) === '1') setOpen(true);
    const savedChat = readSession(CHAT_KEY);
    if (savedChat != null) {
      const n = Number(savedChat);
      if (Number.isFinite(n)) setActiveChatId(n);
    }
    // Mount-only rehydration; subsequent changes are persisted by the effects below.
  }, []);

  useEffect(() => { writeSession(OPEN_KEY, open ? '1' : '0'); }, [open]);
  useEffect(() => { writeSession(CHAT_KEY, activeChatId == null ? null : String(activeChatId)); }, [activeChatId]);

  const setContext = useCallback((patch: Partial<BrainPageContext>) => {
    setPageContext((prev) => {
      // Avoid a state churn loop when a page re-publishes identical context.
      const next = { ...prev, ...patch };
      if (
        next.projectId === prev.projectId &&
        next.viewingProjectId === prev.viewingProjectId &&
        next.modality === prev.modality &&
        next.extraSystem === prev.extraSystem &&
        next.initialChatId === prev.initialChatId &&
        next.initialPrompt === prev.initialPrompt &&
        next.initialTicket === prev.initialTicket
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const value = useMemo<BrainContextValue>(
    () => ({ ...pageContext, open, setOpen, setContext, activeChatId, setActiveChatId }),
    [pageContext, open, setContext, activeChatId],
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
