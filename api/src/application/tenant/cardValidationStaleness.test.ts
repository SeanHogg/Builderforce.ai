/**
 * A VALIDATED CARD MUST BE ABLE TO STOP BEING VALIDATED.
 *
 * `card_validated_at` was stamped once and only `setup_intent.setup_failed` ever
 * cleared it, so a card that later expired, was detached, or failed a real charge
 * kept PREMIUM unlocked indefinitely. Three things close that, and all three are
 * needed because they cover different failure shapes:
 *
 *   • `payment_method.detached` — the card was REMOVED (portal, replace, or Stripe).
 *   • `subscription.past_due`   — the card was CHARGED and DECLINED.
 *   • the staleness window      — nothing happened at all, which is what card EXPIRY
 *     looks like: no charge, no detach, no webhook, the card simply stops working.
 *
 * The first two are covered where they live (the provider parser and the webhook
 * route); this file pins the third, which is the one with no event to hang a test on.
 */

import { describe, it, expect } from 'vitest';
import { isCardValidated, CARD_VALIDATION_MAX_AGE_MS } from './cardValidationService';

const at = (msAgo: number) => new Date(Date.now() - msAgo);

describe('isCardValidated — staleness window', () => {
  it('trusts a recent validation', () => {
    expect(isCardValidated({ status: 'validated', validatedAt: at(24 * 60 * 60 * 1000) })).toBe(true);
  });

  it('stops trusting one older than the window', () => {
    // The case with no event behind it: cards expire silently, so without an age
    // bound a validation from three years ago still unlocks premium today.
    expect(isCardValidated({ status: 'validated', validatedAt: at(CARD_VALIDATION_MAX_AGE_MS + 1000) })).toBe(false);
  });

  it('is exclusive at the boundary — a validation exactly at the limit has expired', () => {
    const now = Date.now();
    const exactly = new Date(now - CARD_VALIDATION_MAX_AGE_MS);
    expect(isCardValidated({ status: 'validated', validatedAt: exactly }, now)).toBe(false);
    expect(isCardValidated({ status: 'validated', validatedAt: new Date(exactly.getTime() + 1) }, now)).toBe(true);
  });

  it('still requires BOTH the status and the timestamp', () => {
    expect(isCardValidated({ status: 'failed', validatedAt: at(0) })).toBe(false);
    expect(isCardValidated({ status: 'none', validatedAt: at(0) })).toBe(false);
    expect(isCardValidated({ status: 'validated', validatedAt: null })).toBe(false);
  });

  it('takes an injected clock, so the boundary is testable without mocking time', () => {
    const validatedAt = new Date('2026-01-01T00:00:00Z');
    const justInside = validatedAt.getTime() + CARD_VALIDATION_MAX_AGE_MS - 1;
    const justOutside = validatedAt.getTime() + CARD_VALIDATION_MAX_AGE_MS;
    expect(isCardValidated({ status: 'validated', validatedAt }, justInside)).toBe(true);
    expect(isCardValidated({ status: 'validated', validatedAt }, justOutside)).toBe(false);
  });

  it('is a year, not a month — an ordinary customer never meets it', () => {
    // A cadence short enough to bother real customers would get relaxed or bypassed;
    // this is a backstop against a stale unlock, not a re-verification schedule.
    expect(CARD_VALIDATION_MAX_AGE_MS).toBe(365 * 24 * 60 * 60 * 1000);
  });
});
