/**
 * Start a creation session from a prompt — THE one use case every prompt-led door calls.
 *
 * No 'use client' directive: a plain async function, imported from client boundaries.
 *
 * Four doors open a session from a sentence — `/create/new?prompt=`, the legacy
 * `/brainstorm?prompt=` redirect, the dashboard's build box and the Studio home — and each
 * had written its own copy of the same decisions. The decisions, written once, local-first:
 *
 *   - A board is ALWAYS created on this device first (`createLocalCreationSession`), under the
 *     destination the person is in: the workspace's for someone in one, unbound for someone with
 *     none yet. There is no server create to fail and so no fallback branch and no `local-` id:
 *     the id is the board's id on the server too, and the sync driver sends the board once it can.
 *   - A plan limit is not thrown here any more. The server refuses a board over the workspace's
 *     limit as a `rejected` receipt, the board stays on the device, and the board's surface shows
 *     the upgrade path (`useBoardSyncOutcome` → `UpgradeModal`) — the person never builds on a
 *     board their plan then silently drops.
 *   - Someone SIGNED IN without a workspace gets a local board too, bound once they have one.
 *     Never a guest lead: a signed-in customer's prompt belongs to a tenant canvas, and filing it
 *     in the funnel would double-count them.
 *   - Everyone else gets a guest board, and their prompt is recorded under the door they used
 *     (`startGuestCreationSession`).
 *
 * Pure of routing: it answers with the board id and where it lives, and the caller decides which
 * URL (and which lens) that id opens at.
 */
import { createLocalCreationSession } from '@/lib/pendingWork';
import { startGuestCreationSession, type GuestPromptSurface } from '@/lib/guestPromptCapture';

export interface StartCreationSessionInput {
  prompt: string;
  /** Signed in at all. Without a workspace that still means NOT a guest lead. */
  isAuthenticated: boolean;
  /** In a workspace — with `isAuthenticated`, the board is created in it and synced. */
  hasTenant: boolean;
  /** Which door a guest used, for the funnel. Ignored for a signed-in person. */
  surface: GuestPromptSurface;
}

export interface StartedCreationSession {
  sessionId: string;
  /** `server` for a board in a workspace (it syncs); `local` for a guest and for someone with no workspace yet. */
  persistence: 'local' | 'server';
}

export async function startCreationSession({ prompt, isAuthenticated, hasTenant, surface }: StartCreationSessionInput): Promise<StartedCreationSession> {
  const initialPrompt = prompt.trim();
  if (!isAuthenticated) return { sessionId: startGuestCreationSession(initialPrompt, { surface }), persistence: 'local' };
  return { sessionId: createLocalCreationSession(initialPrompt), persistence: hasTenant ? 'server' : 'local' };
}
