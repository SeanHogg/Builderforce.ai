import { describe, expect, it } from 'vitest';
import {
  GUEST_PROMPT_MAX_CHARS,
  parseGuestPrompt,
  toGuestPromptSurface,
} from './GuestPrompt';

describe('parseGuestPrompt', () => {
  it('keeps a real prompt and defaults the optional fields', () => {
    const parsed = parseGuestPrompt({ visitorId: 'v1', prompt: 'Build me a CRM' });
    expect(parsed).toEqual({
      ok: true,
      value: { visitorId: 'v1', prompt: 'Build me a CRM', surface: 'landing', sessionRef: null, visitId: null, mode: null },
    });
  });

  it('collapses whitespace so one intent groups as one intent', () => {
    const a = parseGuestPrompt({ visitorId: 'v1', prompt: '  Build me\n\na   CRM  ' });
    const b = parseGuestPrompt({ visitorId: 'v1', prompt: 'Build me a CRM' });
    expect(a.ok && b.ok && a.value.prompt).toBe(b.ok ? b.value.prompt : null);
  });

  it('rejects nothing-typed without calling it an error', () => {
    expect(parseGuestPrompt({ visitorId: 'v1', prompt: '   ' })).toEqual({ ok: false, reason: 'empty' });
    expect(parseGuestPrompt({ visitorId: 'v1' })).toEqual({ ok: false, reason: 'empty' });
    expect(parseGuestPrompt({ visitorId: 'v1', prompt: 42 })).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects a stray keystroke', () => {
    expect(parseGuestPrompt({ visitorId: 'v1', prompt: 'a' })).toEqual({ ok: false, reason: 'too_short' });
  });

  it('caps length — this is an unauthenticated write, not blob storage', () => {
    const parsed = parseGuestPrompt({ visitorId: 'v1', prompt: 'x'.repeat(GUEST_PROMPT_MAX_CHARS + 500) });
    expect(parsed.ok && parsed.value.prompt).toHaveLength(GUEST_PROMPT_MAX_CHARS);
  });

  it('truncates rather than rejects an over-long session ref or mode', () => {
    const parsed = parseGuestPrompt({
      visitorId: 'v1', prompt: 'Build a CRM', sessionRef: 's'.repeat(200), mode: 'm'.repeat(40),
    });
    expect(parsed.ok && parsed.value.sessionRef).toHaveLength(80);
    expect(parsed.ok && parsed.value.mode).toHaveLength(16);
  });
});

describe('toGuestPromptSurface', () => {
  it('passes the known surfaces through', () => {
    for (const s of ['landing', 'canvas', 'brain', 'room']) expect(toGuestPromptSurface(s)).toBe(s);
  });

  it('files an unknown surface under the front door rather than losing the prompt', () => {
    expect(toGuestPromptSurface('spaceship')).toBe('landing');
    expect(toGuestPromptSurface(undefined)).toBe('landing');
  });
});
