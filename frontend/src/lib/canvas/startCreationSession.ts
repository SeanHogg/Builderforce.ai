/**
 * Start a creation session from a prompt — THE one use case every prompt-led door calls.
 *
 * No 'use client' directive: a plain async function, imported from client boundaries.
 *
 * Four doors open a session from a sentence — `/create/new?prompt=`, the legacy
 * `/brainstorm?prompt=` redirect, the dashboard's build box and the Studio home — and each
 * had written its own copy of the same three decisions, each slightly differently: the
 * dashboard fell back to a local board but filed nothing, `/create/new` filed a signed-in
 * person's fallback as a GUEST lead, and the brainstorm redirect did not fall back at all.
 * The decisions, written once:
 *
 *   - A person with a workspace gets a SERVER session (`creationSessionsApi.create`), the
 *     prompt carried as its `initial:` timeline row so the canvas's first turn runs on it.
 *   - If that fails for any reason but the plan, they still get to work: a LOCAL board
 *     (`createLocalCreationSession`) that is claimed into their workspace on the next
 *     load. Not `startGuestCreationSession` — a signed-in customer is not a guest lead,
 *     and filing their prompt in the funnel would double-count them.
 *   - A plan limit is RETHROWN. It is the one failure a local board would hide: the
 *     person would build on a board their plan then refuses to keep. The caller shows the
 *     upgrade path (`UpgradeModal`).
 *   - Everyone else gets a guest board, and their prompt is recorded under the door they
 *     used (`startGuestCreationSession`).
 *
 * Pure of routing: it answers with the session id and where it lives, and the caller
 * decides which URL (and which lens) that id opens at.
 */
import { createLocalCreationSession } from '@/domains/canvas/infrastructure/localCanvasStore';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { startGuestCreationSession, type GuestPromptSurface } from '@/lib/guestPromptCapture';
import { isPlanLimitError } from '@/lib/planLimitError';

export interface StartCreationSessionInput {
  prompt: string;
  /** Signed in AND in a workspace — the only case a server session can be created for. */
  hasTenant: boolean;
  /** Which door a guest used, for the funnel. Ignored for a signed-in person. */
  surface: GuestPromptSurface;
}

export interface StartedCreationSession {
  sessionId: string;
  /** `local` for a guest, and for a signed-in person whose server create failed. */
  persistence: 'local' | 'server';
}

/** The title a session starts with: the prompt's first 80 characters, or the server's default. */
function sessionTitle(prompt: string): string | undefined {
  return prompt.trim().slice(0, 80) || undefined;
}

export async function startCreationSession({ prompt, hasTenant, surface }: StartCreationSessionInput): Promise<StartedCreationSession> {
  const initialPrompt = prompt.trim();
  if (!hasTenant) return { sessionId: startGuestCreationSession(initialPrompt, { surface }), persistence: 'local' };
  const title = sessionTitle(initialPrompt);
  try {
    const { session } = await creationSessionsApi.create({
      ...(title ? { title } : {}),
      ...(initialPrompt ? { initialPrompt } : {}),
    });
    return { sessionId: session.id, persistence: 'server' };
  } catch (error) {
    if (isPlanLimitError(error)) throw error;
    return { sessionId: createLocalCreationSession(initialPrompt), persistence: 'local' };
  }
}
