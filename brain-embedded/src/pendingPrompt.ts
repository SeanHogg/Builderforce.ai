'use client';

/**
 * Client-side handoff for a prompt a visitor typed before they had an account.
 * A marketing/landing page saves the prompt here, sends the visitor through
 * auth, and once they're back inside the authenticated app the Brain takes it
 * and sends it as the first message.
 *
 * Single-use by design: `takePendingPrompt` reads AND clears, so a route
 * re-mount or page refresh can't replay the same prompt twice. Storage-only
 * (localStorage), single browser — no server record.
 */

const PENDING_PROMPT_KEY = 'bf_pending_prompt';

/** Persist a landing-page prompt for replay after authentication. No-ops on empty input or SSR. */
export function savePendingPrompt(text: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    window.localStorage.setItem(PENDING_PROMPT_KEY, trimmed);
  } catch {
    /* storage unavailable (private mode / quota) — drop silently */
  }
}

/** Read and clear the saved prompt. Returns null when none is stored or on SSR. */
export function takePendingPrompt(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(PENDING_PROMPT_KEY);
    if (value != null) window.localStorage.removeItem(PENDING_PROMPT_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}
