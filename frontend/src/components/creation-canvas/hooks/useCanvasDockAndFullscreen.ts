/** The Brain dock preferences and full-screen mode. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect } from 'react';
import { isBrainAutoApprove } from '@/lib/brain/autoApprove';
import { type BrainDockPreferences, readBrainDockPreferences, writeBrainDockPreferences } from '../brainDockPreferences';
import { type CanvasSurfaceId, readCanvasSurface } from '@/lib/canvasSurfaces';
import { trackActivity } from '@/lib/activity/tracker';
import { canvasSurface } from '@/lib/canvasHost';

export interface UseCanvasDockAndFullscreenDeps {
  autoApplyRef: RefObject<boolean>;
  comparisonModelIds: string[];
  fullscreen: boolean;
  initialSurface: CanvasSurfaceId | undefined;
  nativeFullscreenRef: RefObject<boolean>;
  phoneViewport: boolean;
  sessionId: string;
  setAutoApply: Dispatch<SetStateAction<boolean>>;
  setBrainDock: Dispatch<SetStateAction<BrainDockPreferences>>;
  setFullscreen: Dispatch<SetStateAction<boolean>>;
  setSurfaceState: Dispatch<SetStateAction<CanvasSurfaceId>>;
  shellRef: RefObject<HTMLDivElement | null>;
}

export function useCanvasDockAndFullscreen({ autoApplyRef, comparisonModelIds, fullscreen, initialSurface, nativeFullscreenRef, phoneViewport, sessionId, setAutoApply, setBrainDock, setFullscreen, setSurfaceState, shellRef }: UseCanvasDockAndFullscreenDeps) {
  useEffect(() => {
    const enabled = isBrainAutoApprove();
    autoApplyRef.current = enabled;
    setAutoApply(enabled);
  }, []);

  useEffect(() => { setBrainDock(readBrainDockPreferences()); }, []);
  // BRAIN NEVER AUTO-COVERS A PHONE. The stored (and default) preference is a docked
  // rail standing open, which is the desktop. At phone width that same preference is a
  // sheet over the board, so the first paint that learns it is a phone closes it without
  // writing — a reload must not cover the surface, and a desktop that last left Brain
  // open must not find it shut when they come back. The launcher is how it opens.
  useEffect(() => {
    if (!phoneViewport) return;
    setBrainDock((current) => (current.open ? { ...current, open: false } : current));
  }, [phoneViewport]);
  /**
   * The surface the visitor last chose to work on, restored after hydration rather than
   * in the initial state — `localStorage` does not exist on the server, and a first
   * render that disagreed with the markup would flash the wrong surface. A canvas opened
   * FOR a model comparison keeps the space it was opened into; the stored preference is
   * about where someone works, not about what a link asked for.
   */
  useEffect(() => {
    if (comparisonModelIds.length >= 2) return;
    // An ENTRY that named a surface outranks the stored preference: "open my chat" has
    // to open the chat even for someone whose last visit left them on the board. The
    // preference is where you were, not what you just asked for — the same precedence
    // the comparison case above already asserts.
    setSurfaceState(initialSurface ?? readCanvasSurface());
    // Mount only: this restores a preference, and re-running it would drag the visitor
    // back out of whatever surface they have since switched to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Persist AND report the layout the user chose. The signal is what lets the
   * shipped default become the layout people actually prefer instead of a guess.
   * A resize drag passes persist=false so the board reflows live without writing
   * storage — and firing a preference signal — on every pointer move.
   */
  const updateBrainDock = useCallback((patch: Partial<BrainDockPreferences>, persist = true) => {
    setBrainDock((current) => {
      const next = { ...current, ...patch };
      if (persist) {
        writeBrainDockPreferences(next);
        trackActivity('creation_brain_dock_preference', { sessionId, metadata: { clientSurface: canvasSurface(), ...next } });
      }
      return next;
    });
  }, [sessionId]);

  /**
   * Fill the screen with the board, natively where the browser offers it and by
   * taking over the viewport where it does not.
   *
   * iOS Safari exposes no element Fullscreen API at all, so the button used to
   * report "full screen unavailable" on the one class of device where handing the
   * whole screen to the canvas is worth the most. The CSS fallback (see
   * `[data-fullscreen]` in the stylesheet) pins the shell over the app chrome and
   * the mobile bottom bar, which is the same result the native call would give.
   */
  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (typeof document === 'undefined' || !shell) return;
    if (document.fullscreenElement) { void document.exitFullscreen?.().catch(() => undefined); return; }
    if (fullscreen) { setFullscreen(false); return; }
    const request = document.fullscreenEnabled ? shell.requestFullscreen?.() : undefined;
    if (request) void request.catch(() => setFullscreen(true));
    else setFullscreen(true);
  }, [fullscreen]);

  useEffect(() => {
    // Only the native path owns the flag while IT is what is on screen. Without
    // this guard a `fullscreenchange` fired by anything else on the page (a video,
    // say) would silently drop the canvas out of the CSS fallback.
    const sync = () => {
      const native = !!document.fullscreenElement && document.fullscreenElement === shellRef.current;
      if (!native && !nativeFullscreenRef.current) return;
      nativeFullscreenRef.current = native;
      setFullscreen(native);
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  // Escape leaves the CSS fallback, the way it leaves native full screen — the
  // browser handles that key itself only when the browser put us there.
  useEffect(() => {
    if (!fullscreen || nativeFullscreenRef.current) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullscreen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen]);
  return { updateBrainDock, toggleFullscreen };
}
