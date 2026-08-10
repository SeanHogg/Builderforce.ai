'use client';

/**
 * Record what a logged-out visitor asked for — the ONE client-side capture point.
 *
 * The product's front door is a composer: a visitor lands, types what they want
 * built, and a session opens. That first sentence is the only thing most leads
 * ever tell us, and it used to exist nowhere but their own browser — the landing
 * hero creates the session locally (`createLocalCreationSession`) and navigates,
 * so the server saw nothing until a model call happened a page later, if it ever
 * did. Everyone who bounced on the way was invisible, which is precisely the
 * drop-off worth measuring.
 *
 * This closes that. In-session turns are NOT sent from here: the gateway already
 * has them and harvests them server-side, so a canvas turn costs no extra round
 * trip. Only surfaces that submit BEFORE a model call — today the landing hero —
 * call this.
 *
 * Fire-and-forget by construction. It never rejects, never blocks a navigation,
 * and is `keepalive` so the request survives the page transition that follows it
 * by milliseconds — without that, the capture would be cancelled exactly when it
 * matters most.
 */

import { apiRequestStream } from './apiClient';
import { getVisitorId, getFirstTouch } from './visitor';
import { createLocalCreationSession } from './creationSessions';
import { NEW_CHAT_MODE, type ChatMode } from './brain';

/** Where the prompt was typed. Mirrors `GUEST_PROMPT_SURFACES` on the server;
 *  an unknown value is filed under the front door rather than dropped. */
export type GuestPromptSurface = 'landing' | 'canvas' | 'brain' | 'room';

export interface RecordGuestPromptInput {
  prompt: string;
  surface: GuestPromptSurface;
  /** The local session the prompt opened, so intent joins to what came of it. */
  sessionRef?: string;
  /** The chat/work mode armed on the composer. */
  mode?: string;
}

/**
 * Send one prompt to the funnel. Resolves `false` when there was nothing to
 * record or the request could not be made — never throws, and never gates the
 * caller's next step on the result.
 */
export async function recordGuestPrompt(input: RecordGuestPromptInput): Promise<boolean> {
  const visitorId = getVisitorId();
  const prompt = input.prompt.trim();
  if (!visitorId || !prompt) return false;

  try {
    const res = await apiRequestStream('/api/guest/prompt', {
      method: 'POST',
      auth: 'none',
      keepalive: true,
      body: JSON.stringify({
        visitorId,
        prompt,
        surface: input.surface,
        sessionRef: input.sessionRef,
        mode: input.mode,
        // First-touch attribution rides the FIRST prompt, so a lead created here
        // carries its referrer and campaign rather than being an orphan that only
        // gains attribution if the visitor later opens the Brain.
        touch: getFirstTouch(),
      }),
      // A visitor over the daily ceiling still gets into the product; the refusal
      // is telemetry, not a fault worth reporting.
      expectedErrors: [400, 401, 403, 404, 429],
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Open a logged-out creation session from a prompt — and record that prompt.
 *
 * THE only way a logged-out surface should start a prompt-led session. There are
 * four of them (the landing hero, `/create/new?prompt=`, the legacy
 * `/brainstorm?prompt=` redirect, and the shell's own redirect for old campaign
 * links), and every one of them previously called `createLocalCreationSession`
 * directly — which is how the capture came to be missing everywhere at once. A
 * helper that does both is the only version of this that cannot drift back.
 *
 * Signed-in surfaces do NOT use this: their prompt belongs to a tenant canvas,
 * not to the anonymous lead funnel, and filing it here would double-count a
 * customer as a lead.
 *
 * Returns the local session id to navigate to. The capture never delays it.
 */
export function startGuestCreationSession(
  prompt: string,
  opts: { mode?: ChatMode; surface?: GuestPromptSurface } = {},
): string {
  const mode = opts.mode ?? NEW_CHAT_MODE;
  const sessionId = createLocalCreationSession(prompt, mode);
  void recordGuestPrompt({
    prompt,
    surface: opts.surface ?? 'landing',
    sessionRef: sessionId,
    mode,
  });
  return sessionId;
}
