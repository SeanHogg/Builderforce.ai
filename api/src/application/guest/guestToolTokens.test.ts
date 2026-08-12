import { describe, expect, it } from 'vitest';
import { GUEST_CHAT_LIMITS } from '../../domain/tenant/PlanLimits';

/**
 * A guest CHAT turn writes a paragraph; a guest CANVAS turn writes its artifact
 * INSIDE the tool call. Clamping both to 700 output tokens truncated every call large
 * enough to carry real content — `finish_reason: "length"`, no parseable tool call —
 * so a turn that generated for twenty seconds arrived as nothing, and the calls that
 * did survive were the ones small enough to fit: `{x, y, kind, title}`, i.e. an empty
 * shell. Measured 2026-08-12 (ui 2026.7.213).
 */
describe('guest output ceilings', () => {
  it('gives a tool-carrying turn room to finish a tool call', () => {
    expect(GUEST_CHAT_LIMITS.maxToolTokensPerRequest).toBeGreaterThan(GUEST_CHAT_LIMITS.maxTokensPerRequest);
    // Matches the canvas client's own CANVAS_RESPONSE_TOKENS, so the ceiling is no
    // longer what decides whether an artifact can be authored.
    expect(GUEST_CHAT_LIMITS.maxToolTokensPerRequest).toBe(3_200);
  });

  it('leaves the conversational ceiling where it was', () => {
    expect(GUEST_CHAT_LIMITS.maxTokensPerRequest).toBe(700);
  });

  it('keeps the real cost control on TURNS, not on answer length', () => {
    expect(GUEST_CHAT_LIMITS.messagesDailyLimit).toBe(10);
    expect(GUEST_CHAT_LIMITS.ipMessagesDailyLimit).toBeGreaterThan(GUEST_CHAT_LIMITS.messagesDailyLimit);
  });
});
