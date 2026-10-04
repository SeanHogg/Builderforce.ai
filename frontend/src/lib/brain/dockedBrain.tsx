// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

/**
 * Whether this surface already shows the Brain DOCKED (the IDE / Studio left
 * column) — and how to bring it into view.
 *
 * The docked panel and the floating drawer share one chat selection through
 * BrainContext, so anything that "opens a chat" only has to select it. Opening
 * the drawer as well put a SECOND chat panel on the right of a workspace that
 * already had one on the left. Entry points (e.g. `TeamChatButton`) read this
 * and reveal the docked panel instead; with no provider they open the drawer.
 *
 * It is also how a surface beside the chat hands the person a ready-made message
 * ("use this image in the app — where?"): `seedComposer` puts text in the docked
 * composer for them to finish and send. It never sends on their behalf.
 */
export interface DockedBrain {
  /** Bring the docked panel into view (e.g. the chat pane on a narrow screen). */
  reveal: () => void;
  /** Put `text` in the docked composer and bring the chat into view. */
  seedComposer: (text: string) => void;
  /** The docked composer registers how to receive seeded text; returns the unregister. */
  registerComposer: (seed: (text: string) => void) => () => void;
}

const DockedBrainContext = createContext<DockedBrain | null>(null);

export function DockedBrainProvider({ reveal, children }: { reveal: () => void; children: ReactNode }) {
  const composer = useRef<((text: string) => void) | null>(null);
  const registerComposer = useCallback((seed: (text: string) => void) => {
    composer.current = seed;
    return () => { if (composer.current === seed) composer.current = null; };
  }, []);
  const seedComposer = useCallback((text: string) => {
    composer.current?.(text);
    reveal();
  }, [reveal]);
  const value = useMemo<DockedBrain>(() => ({ reveal, seedComposer, registerComposer }), [reveal, seedComposer, registerComposer]);
  return <DockedBrainContext.Provider value={value}>{children}</DockedBrainContext.Provider>;
}

/** The surface's docked Brain, or null when chats open in the floating drawer. */
export function useDockedBrain(): DockedBrain | null {
  return useContext(DockedBrainContext);
}

/** Called by the docked composer: receive text a neighbouring surface seeds. */
export function useDockedComposerSeed(enabled: boolean, seed: (text: string) => void): void {
  const docked = useDockedBrain();
  useEffect(() => (enabled && docked ? docked.registerComposer(seed) : undefined), [enabled, docked, seed]);
}
