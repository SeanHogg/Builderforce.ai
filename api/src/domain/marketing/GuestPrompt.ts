/**
 * The prompt an anonymous visitor typed to start a session — as a domain value.
 *
 * This platform's front door is a composer, not a signup form: a visitor lands,
 * types what they want built, and a real session opens. That makes the prompt
 * the first and often ONLY thing a lead ever tells us, so it is worth a value
 * object rather than a string passed around three layers.
 *
 * Everything here is pure. Normalisation and the surface vocabulary have to be
 * identical whether a prompt arrives from the landing composer (an explicit
 * `POST /api/guest/prompt`) or is harvested from a turn passing through the LLM
 * gateway — two entry points, one definition, so the two can never disagree
 * about what got stored.
 */

import { isVisitId } from './VisitorJourney';

/**
 * Where a prompt was typed.
 *
 * `landing` is the homepage hero composer, the only one that fires before any
 * model call exists; the other three are turns inside a session that has already
 * started. Keeping them apart is what lets the console answer "do people who
 * start from the homepage ask for different things than people already on a
 * canvas" — which is the question that decides what the homepage should say.
 */
export const GUEST_PROMPT_SURFACES = ['landing', 'canvas', 'brain', 'room'] as const;

export type GuestPromptSurface = (typeof GUEST_PROMPT_SURFACES)[number];

/**
 * The longest prompt we store. Generous enough for a real brief (a pasted spec
 * runs long) and bounded because this is an UNAUTHENTICATED write: the cap is
 * what stops the endpoint being free blob storage.
 */
export const GUEST_PROMPT_MAX_CHARS = 4_000;

/** The shortest thing worth calling intent. Below this it is a stray keystroke. */
export const GUEST_PROMPT_MIN_CHARS = 2;

/** How many prompts one visitor may record in a UTC day, and one IP behind them.
 *  An abuse ceiling, not a product limit — a real session records a handful. */
export const GUEST_PROMPT_LIMITS = {
  visitorDailyLimit: 120,
  ipDailyLimit: 400,
} as const;

/** A prompt that has been validated and is safe to persist. */
export interface GuestPrompt {
  visitorId: string;
  prompt: string;
  surface: GuestPromptSurface;
  sessionRef: string | null;
  /** The visit it was typed in (migration 1109). Joins the prompt to the pages
   *  around it in the visitor journey (`activity_log.target_id`, 1111), so the
   *  flow graph can draw "asked for X, then went to Y" instead of two unrelated
   *  streams. */
  visitId: string | null;
  mode: string | null;
}

/** Why a submitted prompt was not stored. `empty` is expected and not an error. */
export type GuestPromptRejection = 'empty' | 'too_short';

export type GuestPromptParse =
  | { ok: true; value: GuestPrompt }
  | { ok: false; reason: GuestPromptRejection };

/** The one place a surface string becomes a surface, defaulting rather than throwing:
 *  an unrecognised surface is a client that is ahead of or behind this deploy, and
 *  losing the prompt over it would be worse than filing it under the front door. */
export function toGuestPromptSurface(value: unknown): GuestPromptSurface {
  return GUEST_PROMPT_SURFACES.includes(value as GuestPromptSurface)
    ? (value as GuestPromptSurface)
    : 'landing';
}

/**
 * Normalise raw input into a storable prompt.
 *
 * Collapses runs of whitespace — a prompt typed across three lines and the same
 * prompt on one line are the same intent, and leaving them distinct would split
 * every "what do people ask for" grouping in two.
 */
export function parseGuestPrompt(input: {
  visitorId: string;
  prompt?: unknown;
  surface?: unknown;
  sessionRef?: unknown;
  visitId?: unknown;
  mode?: unknown;
}): GuestPromptParse {
  const raw = typeof input.prompt === 'string' ? input.prompt : '';
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return { ok: false, reason: 'empty' };
  if (normalized.length < GUEST_PROMPT_MIN_CHARS) return { ok: false, reason: 'too_short' };

  const sessionRef = typeof input.sessionRef === 'string' && input.sessionRef.trim()
    ? input.sessionRef.trim().slice(0, 80)
    : null;
  const mode = typeof input.mode === 'string' && input.mode.trim()
    ? input.mode.trim().slice(0, 16)
    : null;

  return {
    ok: true,
    value: {
      visitorId: input.visitorId,
      prompt: normalized.slice(0, GUEST_PROMPT_MAX_CHARS),
      surface: toGuestPromptSurface(input.surface),
      sessionRef,
      visitId: isVisitId(input.visitId) ? input.visitId : null,
      mode,
    },
  };
}
