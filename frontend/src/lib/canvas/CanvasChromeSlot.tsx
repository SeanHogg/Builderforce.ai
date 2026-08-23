'use client';

import React, { createContext, useContext, useMemo, useState } from 'react';

/**
 * WHERE THE CANVAS DRAWS ITS HANDOFF ROW — the header, when there is one.
 *
 * ── THE PROBLEM THIS EXISTS FOR ──────────────────────────────────────────────────
 * The canvas floated its own card in the top-right corner holding Make it real,
 * Invite, Publish and the overflow. Fourteen pixels above it sat the application
 * header, running the full width of the window, with its own right-hand cluster. Two
 * bars, one screen, one corner — and the operator read them as one thing that had
 * been drawn twice. (The first casualty was `Save & collaborate`, which said the same
 * word as the header's green CTA; removing it left the SHAPE of the problem behind.)
 *
 * So the actions move up into the header and the corner goes quiet.
 *
 * ── WHY A DOM SLOT AND NOT A CONTEXT OF HANDLERS ─────────────────────────────────
 * The obvious move — publish the action handlers to the shell and let the header
 * render them — is the wrong one twice over. It would make the header know about
 * surfaces, share panels, template menus and the account gate, which is a header
 * growing into the canvas's job; and it would put the canvas's own state behind a
 * context boundary, so every menu open would re-render the shell.
 *
 * The canvas keeps rendering its row, with its state, its handlers and its menus
 * anchored to their own triggers. Only the DOM POSITION moves. That is what
 * `createPortal` is for, and it means the header contributes a container and no
 * knowledge — the narrowest contract the two can share.
 *
 * ── AND WHY IT DEGRADES INSTEAD OF BREAKING ──────────────────────────────────────
 * `useCanvasChromeSlot()` answers `null` wherever no header offered one: the VS Code
 * webview, the `/embed` tree, a component test rendering `<CreationCanvas>` on its
 * own. Those surfaces get the floating corner card exactly as before, because the
 * canvas falls back to rendering in place rather than portalling into nothing. A
 * surface cannot lose its actions by forgetting to mount a target.
 */

interface CanvasChromeSlotValue {
  /** The header's container, once it has mounted one. */
  element: HTMLElement | null;
  /** Callback ref handed to the target. Stable, so React never re-runs it. */
  register: (node: HTMLElement | null) => void;
}

const CanvasChromeSlotContext = createContext<CanvasChromeSlotValue | null>(null);

export function CanvasChromeSlotProvider({ children }: { children: React.ReactNode }) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  // `setElement` is identity-stable, so the target's callback ref fires on mount and
  // unmount only — never on every render of the header around it.
  const value = useMemo<CanvasChromeSlotValue>(() => ({ element, register: setElement }), [element]);
  return <CanvasChromeSlotContext.Provider value={value}>{children}</CanvasChromeSlotContext.Provider>;
}

/**
 * The header's mount point for the canvas's own controls.
 *
 * Renders NOTHING outside a shell that provides the slot — a marketing page mounts
 * the same header component and must not sprout an empty box in its button row. The
 * box is also empty whenever no canvas is on the stage, which the stylesheet handles
 * with `:empty`; there is no "is there a board" boolean for the header to hold.
 */
export function CanvasChromeSlotTarget({ className }: { className?: string }) {
  const slot = useContext(CanvasChromeSlotContext);
  if (!slot) return null;
  return <div ref={slot.register} className={className} data-testid="canvas-chrome-slot" />;
}

/** The element the canvas should portal its handoff row into, or `null` for none. */
export function useCanvasChromeSlot(): HTMLElement | null {
  return useContext(CanvasChromeSlotContext)?.element ?? null;
}
