import { describe, it, expect } from 'vitest';
import { BrainRequestError, brainRequestError, chatErrorAction, LOCAL_ENGINE_FAILURE_CODES, NO_LOCAL_MODEL, NO_SPECIFIC_MODEL, NOT_SIGNED_IN } from './chatError';

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

  it('reads the nested OpenAI-shaped body a page engine refuses with', () => {
    const err = brainRequestError(503, { error: { code: 'model_keeps_crashing', message: 'model_keeps_crashing: bonsai-8b trapped twice' } });
    expect(err.code).toBe('model_keeps_crashing');
    expect(err.message).toBe('model_keeps_crashing: bonsai-8b trapped twice');
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

  it('tells "sign in" apart from "nothing on this device" (Local only, or signed in with no cloud)', () => {
    expect(chatErrorAction(new Error(NOT_SIGNED_IN))?.kind).toBe('sign_in');
    expect(chatErrorAction(new Error(NO_LOCAL_MODEL))?.kind).toBe('no_local_model');
  });

  it('names Specific-with-no-pick as its own verdict — never a sign-in or a Hybrid remedy', () => {
    expect(chatErrorAction(new Error(NO_SPECIFIC_MODEL))?.kind).toBe('no_specific_model');
  });

  it('names each on-device engine failure — from the structured code first, else the code in the message', () => {
    for (const code of LOCAL_ENGINE_FAILURE_CODES) {
      expect(chatErrorAction(brainRequestError(503, { error: { code, message: 'x' } }))).toEqual({ kind: 'local_engine_failed', engineCode: code });
    }
    // A stream that failed mid-answer carries only prose, with the code as a word in it.
    expect(chatErrorAction(new Error('the model failed mid-answer: page_engine_detached: The engine stopped'))).toEqual({
      kind: 'local_engine_failed',
      engineCode: 'page_engine_detached',
    });
    expect(chatErrorAction(new Error('bfi_engine_crashed: RuntimeError: unreachable'))?.engineCode).toBe('bfi_engine_crashed');
    // Only the whole word: a longer identifier is not the code.
    expect(chatErrorAction(new Error('xbfi_engine_crashed_y'))).toBeNull();
  });

  it('keeps the gateway verdicts ahead of an engine code in the prose', () => {
    expect(chatErrorAction(brainRequestError(401, { error: 'page_engine_detached' }))?.kind).toBe('auth');
  });
});
