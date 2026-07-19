import { describe, it, expect } from 'vitest';
import { parseOnboardingProgress } from './authRoutes';

/**
 * `onboarding_progress` (migration 0343) is free-form JSON text, written by the
 * setup wizard and read back on every /me. The parser is the ONE validation
 * boundary for both directions — a malformed row must degrade to "no progress"
 * (restart at step 1) rather than break the wizard, and a malformed request body
 * must be rejected before it is stored.
 */
describe('parseOnboardingProgress', () => {
  it('accepts a well-formed builder-track record', () => {
    const parsed = parseOnboardingProgress(
      JSON.stringify({ track: 'builder', completed: ['workspace', 'project'], activeStep: 'ticketing' }),
    );
    expect(parsed).toEqual({ track: 'builder', completed: ['workspace', 'project'], activeStep: 'ticketing' });
  });

  it('accepts the hired track', () => {
    expect(parseOnboardingProgress(JSON.stringify({ track: 'hired', completed: [], activeStep: null })))
      .toEqual({ track: 'hired', completed: [], activeStep: null });
  });

  it.each([
    ['null', null],
    ['empty string', ''],
    ['invalid JSON', '{not json'],
    ['unknown track', JSON.stringify({ track: 'admin', completed: [], activeStep: null })],
    ['missing track', JSON.stringify({ completed: ['workspace'] })],
  ])('degrades to null for %s', (_label, raw) => {
    expect(parseOnboardingProgress(raw)).toBeNull();
  });

  it('coerces a non-array completed list to empty', () => {
    expect(parseOnboardingProgress(JSON.stringify({ track: 'builder', completed: 'workspace' })))
      .toEqual({ track: 'builder', completed: [], activeStep: null });
  });

  it('drops non-string entries and caps the completed list', () => {
    const parsed = parseOnboardingProgress(
      JSON.stringify({ track: 'builder', completed: ['workspace', 42, null, 'project'], activeStep: 7 }),
    );
    expect(parsed).toEqual({ track: 'builder', completed: ['workspace', 'project'], activeStep: null });

    const long = parseOnboardingProgress(
      JSON.stringify({ track: 'hired', completed: Array.from({ length: 100 }, (_, i) => `s${i}`) }),
    );
    expect(long?.completed).toHaveLength(32);
  });
});
