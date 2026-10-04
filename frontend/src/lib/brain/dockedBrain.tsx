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
 * It is also how a surface beside the chat hands the person a message:
 * - `seedComposer` puts text in the docked composer for them to finish and send
 *   ("use this image in the app — where?"). It does not send.
 * - `ask` sends it. Only for a control whose whole meaning is "ask Brain this"
 *   (the preview's "Fix it for me"): the click IS the person sending it.
 */
export interface DockedBrain {
  /** Bring the docked panel into view (e.g. the chat pane on a narrow screen). */
  reveal: () => void;
  /** Put `text` in the docked composer and bring the chat into view. */
  seedComposer: (text: string) => void;
  /** Send `text` as the person's next message and bring the chat into view. */
  ask: (text: string) => void;
  /** The docked composer registers how to receive text; returns the unregister. */
  registerComposer: (composer: DockedComposer) => () => void;
}

/** What the docked composer does with text a neighbouring surface hands it. */
export interface DockedComposer {
  seed: (text: string) => void;
  send: (text: string) => void;
}

const DockedBrainContext = createContext<DockedBrain | null>(null);

export function DockedBrainProvider({ reveal, children }: { reveal: () => void; children: ReactNode }) {
  const composer = useRef<DockedComposer | null>(null);
  const registerComposer = useCallback((next: DockedComposer) => {
    composer.current = next;
    return () => { if (composer.current === next) composer.current = null; };
  }, []);
  const seedComposer = useCallback((text: string) => {
    composer.current?.seed(text);
    reveal();
  }, [reveal]);
  const ask = useCallback((text: string) => {
    composer.current?.send(text);
    reveal();
  }, [reveal]);
  const value = useMemo<DockedBrain>(() => ({ reveal, seedComposer, ask, registerComposer }), [reveal, seedComposer, ask, registerComposer]);
  return <DockedBrainContext.Provider value={value}>{children}</DockedBrainContext.Provider>;
}

/** The surface's docked Brain, or null when chats open in the floating drawer. */
export function useDockedBrain(): DockedBrain | null {
  return useContext(DockedBrainContext);
}

/** Called by the docked composer: receive text a neighbouring surface hands it. */
export function useDockedComposer(enabled: boolean, composer: DockedComposer): void {
  const docked = useDockedBrain();
  useEffect(() => (enabled && docked ? docked.registerComposer(composer) : undefined), [enabled, docked, composer]);
}
