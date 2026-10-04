import { useCallback, useState } from 'react';

/**
 * The four sheets the floating chrome opens — invite, the board's •••, Make it real and
 * the phone's actions sheet — and the toggles that keep them from stacking.
 *
 * Every toggle here is a stable callback, so the chrome components that take them can be
 * memoized: a fresh `() => setMoreOpen(...)` per render of a board this size would undo
 * that on every keystroke in the composer.
 */
export function useCanvasChromeMenus(initialShareOpen: boolean) {
  const [shareOpen, setShareOpen] = useState(initialShareOpen);
  const [moreOpen, setMoreOpen] = useState(false);
  /** The phone's actions sheet — the one that IS the command bar at that width. Its own
   *  flag for the reason `realOpen` has one: three sheets, three presses. */
  const [actionsOpen, setActionsOpen] = useState(false);
  const closeActionsSheet = useCallback(() => setActionsOpen(false), []);
  const toggleActionsSheet = useCallback(() => setActionsOpen((open) => !open), []);
  /** Whether the Make it real menu is open. Its own state and not `moreOpen`'s: the two
   *  sheets sit at opposite ends of the bar and each closes the other, which a shared
   *  flag could not express. */
  const [realOpen, setRealOpen] = useState(false);
  /** Stable so `CanvasMenuSheet` binds its Escape listener once per opening rather
   *  than on every render of a board this size. */
  const closeMoreMenu = useCallback(() => setMoreOpen(false), []);
  const closeRealMenu = useCallback(() => setRealOpen(false), []);
  const toggleRealMenu = useCallback(() => { setRealOpen((value) => !value); setMoreOpen(false); setShareOpen(false); }, []);
  const toggleMoreMenu = useCallback(() => { setMoreOpen((value) => !value); setShareOpen(false); setRealOpen(false); }, []);
  const closeShareSheet = useCallback(() => setShareOpen(false), []);
  /** Every session action closes the sheet it was pressed from — see `useCanvasSessionActionHandlers`. */
  const closeActionMenus = useCallback(() => { setMoreOpen(false); setRealOpen(false); setActionsOpen(false); }, []);
  return {
    shareOpen, setShareOpen, closeShareSheet,
    moreOpen, setMoreOpen, closeMoreMenu, toggleMoreMenu,
    realOpen, closeRealMenu, toggleRealMenu,
    actionsOpen, closeActionsSheet, toggleActionsSheet,
    closeActionMenus,
  };
}
