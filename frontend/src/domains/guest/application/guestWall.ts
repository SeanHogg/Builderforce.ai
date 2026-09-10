/**
 * THE record of "this screen asked for something only an account can read".
 *
 * ── WHY THE TRANSPORT WRITES IT ──────────────────────────────────────────────
 * A signed-out visitor may open every route — that is the product's choice, and
 * the sample workspace fills most of them. Some reads have no fixture, and the
 * API answers those with a 401 that the transport already recognises as "nobody
 * is signed in" rather than a fault ({@link isSignedOutFailure}). For a long
 * time the only thing done with that recognition was to NOT file a support
 * ticket; the surface itself still painted `Missing or malformed Authorization
 * header` in a red box, because the surface only ever saw a string.
 *
 * The honest answer to that read is not silence and not a header name. It is an
 * invitation: this view is yours once you have an account. Saying so needs the
 * fact recorded somewhere a component can subscribe to, and the transport is
 * the ONE place that knows it — the same argument that put `resolveGuestRead`
 * there. So `apiClient` notes the wall here as it throws, and
 * `GuestAccountPrompt` reads it. No surface has to remember; none can forget.
 *
 * ── WHAT IS KEPT ─────────────────────────────────────────────────────────────
 * The pathname the wall was met on. A prompt shows only while the visitor is
 * still standing on that route: navigating away hides it without a reset, and
 * coming back re-fires the reads that record it again. Nothing else — no
 * message, because the message was the defect.
 *
 * `inline` counts the prompts a page has mounted INSIDE its content (a
 * `SectionError` that met the wall, for instance). The shell mounts one
 * catch-all over every page as a centred modal; it stands down while an inline
 * one is showing, so a visitor is invited once, where the missing content would
 * have been.
 *
 * `dismissed` is the route on which the visitor closed that modal. A guest is
 * meant to keep exploring the real app — the invitation is an invitation, not a
 * gate — so closing it must stick, and it must stick against the NEXT refused
 * read on the same route too (a canvas fires several). It is forgotten the
 * moment the wall moves to a different route, which is the visitor asking to see
 * something new.
 *
 * No `'use client'`: a plain module, imported by the transport, that guards on
 * `typeof window` itself. On the server there is no visitor to invite.
 */

export interface GuestWallState {
  /** The route on which a signed-out read was refused, or `null` if none has been. */
  pathname: string | null;
  /** How many prompts are currently mounted inside page content. */
  inline: number;
  /** The route on which the visitor closed the shell's modal invitation. */
  dismissed: string | null;
}

const IDLE: GuestWallState = { pathname: null, inline: 0, dismissed: null };

let state: GuestWallState = IDLE;
const listeners = new Set<() => void>();

function emit(next: GuestWallState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Where the visitor is standing, as the transport sees it. */
function currentPathname(): string | null {
  return typeof window === 'undefined' ? null : window.location.pathname;
}

/** Called by the transport when a read was refused for want of a credential. */
export function noteSignedOutRead(): void {
  const pathname = currentPathname();
  if (!pathname || state.pathname === pathname) return;
  // A new route is a new invitation: whatever was closed on the last one is spent.
  emit({ ...state, pathname, dismissed: null });
}

/** The visitor closed the shell's invitation; it stays closed on this route. */
export function dismissGuestWall(): void {
  if (!state.pathname || state.dismissed === state.pathname) return;
  emit({ ...state, dismissed: state.pathname });
}

/** An inline prompt has mounted (or unmounted); the shell's catch-all follows. */
export function claimInlinePrompt(): () => void {
  emit({ ...state, inline: state.inline + 1 });
  return () => emit({ ...state, inline: Math.max(0, state.inline - 1) });
}

/** For `useSyncExternalStore`. */
export function subscribeGuestWall(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function readGuestWall(): GuestWallState {
  return state;
}

/** The server snapshot, and a test's way back to a clean slate. */
export function resetGuestWall(): GuestWallState {
  if (state !== IDLE) emit(IDLE);
  return IDLE;
}
