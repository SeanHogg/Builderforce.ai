import { describe, expect, it } from 'vitest';
import { readIntent, registerHref, resumeIntent, workspaceChoiceHref } from './auth';

/**
 * PRD 33 §4.2 step 2 — "Start free" survives sign-up, email verification and the
 * workspace choice, landing the buyer back where they were going WITH the intent.
 */
describe('resumeIntent', () => {
  it('folds the intent into the destination so hops that only carry `next` keep it', () => {
    expect(resumeIntent({ next: '/apps/insights/setup', intent: 'install:insights' }))
      .toBe('/apps/insights/setup?intent=install%3Ainsights');
  });

  it('keeps an existing query and hash, and never adds a second intent', () => {
    expect(resumeIntent({ next: '/a?b=1#c', intent: 'x' })).toBe('/a?b=1&intent=x#c');
    expect(resumeIntent({ next: '/a?intent=first', intent: 'second' })).toBe('/a?intent=first');
  });

  it('returns the bare path when there is no intent', () => {
    expect(resumeIntent({ next: '/marketplace/listing/session-replay' })).toBe('/marketplace/listing/session-replay');
  });

  it('falls back for unsafe or missing destinations', () => {
    expect(resumeIntent({ next: 'https://evil.example/x', intent: 'i' })).toBe('/dashboard?intent=i');
    expect(resumeIntent({ next: '//evil.example' })).toBe('/dashboard');
    expect(resumeIntent(null)).toBe('/dashboard');
    expect(resumeIntent({ next: null }, '/elsewhere')).toBe('/elsewhere');
  });

  it('reads next + intent off a query', () => {
    const params = new URLSearchParams('next=%2Fapps%2Finsights%2Fsetup&intent=install%3Ainsights');
    expect(readIntent(params)).toEqual({ next: '/apps/insights/setup', intent: 'install:insights' });
  });

  it('round-trips register → verification → workspace picker → back to the set-up page', () => {
    // 1. The landing CTA.
    const register = registerHref('/apps/insights/setup', 'install:insights');
    const registerQuery = new URLSearchParams(register.slice(register.indexOf('?') + 1));
    // 2. After sign-up + verification the register page goes to resumeIntent(...).
    const afterVerify = resumeIntent(readIntent(registerQuery));
    expect(afterVerify).toBe('/apps/insights/setup?intent=install%3Ainsights');
    // 3. No workspace yet: the picker carries the whole destination as `next`.
    const picker = workspaceChoiceHref({ next: afterVerify });
    expect(picker.startsWith('/tenants?next=')).toBe(true);
    const pickerQuery = new URLSearchParams(picker.slice(picker.indexOf('?') + 1));
    // 4. The picker resumes it once a workspace is chosen.
    const landed = resumeIntent(readIntent(pickerQuery));
    expect(landed).toBe('/apps/insights/setup?intent=install%3Ainsights');
    expect(new URLSearchParams(landed.split('?')[1]).get('intent')).toBe('install:insights');
  });

  it('sends a workspace choice with no destination to the bare picker', () => {
    expect(workspaceChoiceHref(null)).toBe('/tenants');
    expect(workspaceChoiceHref({ intent: 'x' })).toBe('/tenants');
  });
});
