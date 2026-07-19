import { describe, it, expect } from 'vitest';
import { BrainRequestError, brainRequestError, chatErrorAction } from './chatError';

describe('brainRequestError', () => {
  it('keeps the human sentence AND the structured entitlement fields', () => {
    const err = brainRequestError(402, {
      error: 'Premium models require a validated card on file.',
      code: 'premium_model_not_allowed',
      reason: 'card_required',
      unlock: 'validate_card',
      requiredPlan: 'pro',
      feature: 'premiumModels',
    });
    expect(err).toBeInstanceOf(BrainRequestError);
    expect(err.message).toBe('Premium models require a validated card on file.');
    expect(err.code).toBe('premium_model_not_allowed');
    expect(err.requiredPlan).toBe('pro');
  });

  it('falls back through message → statusText → status for the sentence', () => {
    expect(brainRequestError(500, { message: 'boom' }).message).toBe('boom');
    expect(brainRequestError(503, {}, 'Service Unavailable').message).toBe('Service Unavailable');
    expect(brainRequestError(503, {}).message).toBe('Request failed (503)');
  });

  it('ignores non-string / empty fields rather than surfacing junk', () => {
    const err = brainRequestError(402, { error: 'nope', code: 42, unlock: '' });
    expect(err.code).toBeUndefined();
    expect(err.unlock).toBeUndefined();
  });
});

describe('chatErrorAction', () => {
  it('routes a card-required gate to validate_card', () => {
    const err = brainRequestError(402, { error: 'x', reason: 'card_required', unlock: 'validate_card' });
    expect(chatErrorAction(err)?.kind).toBe('validate_card');
  });

  it('routes a plan-required gate to upgrade, carrying the required plan', () => {
    const err = brainRequestError(402, { error: 'x', reason: 'plan_required', unlock: 'upgrade', requiredPlan: 'pro' });
    expect(chatErrorAction(err)).toMatchObject({ kind: 'upgrade', requiredPlan: 'pro' });
  });

  it('treats any other 402 as an upgrade (e.g. strict_pin_not_allowed)', () => {
    const err = brainRequestError(402, { error: 'x', code: 'strict_pin_not_allowed', upgrade: true });
    expect(chatErrorAction(err)?.kind).toBe('upgrade');
  });

  it('routes a 401 to auth', () => {
    expect(chatErrorAction(brainRequestError(401, { error: 'Invalid or expired token' }))?.kind).toBe('auth');
  });

  it('routes a PLAN allowance 429 to upgrade but leaves a provider rate-limit alone', () => {
    expect(chatErrorAction(brainRequestError(429, { error: 'x', code: 'plan_token_limit_exceeded' }))?.kind).toBe('upgrade');
    expect(chatErrorAction(brainRequestError(429, { error: 'Rate limited', code: 'provider_rate_limited' }))).toBeNull();
  });

  it('falls back to prose only when the server sent no structure', () => {
    expect(chatErrorAction(new Error('Invalid or expired token'))?.kind).toBe('auth');
    expect(chatErrorAction(new Error('… require a validated card on file.'))?.kind).toBe('validate_card');
    expect(chatErrorAction(new Error('This requires a paid plan (Pro/Teams).'))?.kind).toBe('upgrade');
  });

  it('offers nothing for an ordinary failure', () => {
    expect(chatErrorAction(new Error('The model timed out.'))).toBeNull();
    expect(chatErrorAction(brainRequestError(500, { error: 'Upstream exploded' }))).toBeNull();
    expect(chatErrorAction(undefined)).toBeNull();
  });
});
