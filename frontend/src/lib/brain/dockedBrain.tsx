// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Whether this surface already shows the Brain DOCKED (the IDE / Studio left
 * column) — and how to bring it into view.
 *
 * The docked panel and the floating drawer share one chat selection through
 * BrainContext, so anything that "opens a chat" only has to select it. Opening
 * the drawer as well put a SECOND chat panel on the right of a workspace that
 * already had one on the left. Entry points (e.g. `TeamChatButton`) read this
 * and reveal the docked panel instead; with no provider they open the drawer.
 */
export interface DockedBrain {
  /** Bring the docked panel into view (e.g. the chat pane on a narrow screen). */
  reveal: () => void;
}

const DockedBrainContext = createContext<DockedBrain | null>(null);

export function DockedBrainProvider({ reveal, children }: DockedBrain & { children: ReactNode }) {
  return <DockedBrainContext.Provider value={{ reveal }}>{children}</DockedBrainContext.Provider>;
}

/** The surface's docked Brain, or null when chats open in the floating drawer. */
export function useDockedBrain(): DockedBrain | null {
  return useContext(DockedBrainContext);
}
