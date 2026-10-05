// No 'use client' directive: imported only from `BrainDock`, `BrainSurfaceActions`,
// `CanvasChatSurface` and `BrainObjectBody`, all inside the canvas's client boundary.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** What the Brain surface's body shows: the conversation, or what it is wired to. */
export type BrainSurfaceView = 'chat' | 'context';

interface BrainSurfaceViewState {
  view: BrainSurfaceView;
  setView: (view: BrainSurfaceView) => void;
}

const BrainSurfaceViewContext = createContext<BrainSurfaceViewState | null>(null);

/**
 * WHICH VIEW ONE BRAIN SURFACE IS SHOWING, shared by its header and its body.
 *
 * The Context toggle used to live in a row of its own under the header — a "CHAT"
 * caption and one icon — because the body owned the view and the header could not reach
 * it. That second row is gone: the toggle sits in the one header row with the other
 * controls, and both read this. Each placement (edge dock, Brain Object, chat surface)
 * wraps its header and body in one provider, so two placements never share a view.
 */
export function BrainSurfaceViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<BrainSurfaceView>('chat');
  const value = useMemo(() => ({ view, setView }), [view]);
  return <BrainSurfaceViewContext.Provider value={value}>{children}</BrainSurfaceViewContext.Provider>;
}

export function useBrainSurfaceView(): BrainSurfaceViewState {
  const state = useContext(BrainSurfaceViewContext);
  if (!state) throw new Error('useBrainSurfaceView must be used inside a BrainSurfaceViewProvider');
  return state;
}
