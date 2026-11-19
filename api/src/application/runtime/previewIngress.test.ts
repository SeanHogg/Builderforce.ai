import { describe, expect, it } from 'vitest';
import { PREVIEW_COOKIE, previewCookieEntry, previewCookieHeader, previewCookieUpgrade } from './previewIngress';

const req = (cookie: string) => new Request('https://preview.builderforce.ai/src/main.tsx', { headers: { cookie } });

describe('preview ingress cookie', () => {
  it('pins the token under the __Host- name without a Domain', () => {
    const header = previewCookieHeader('1.2.abc');
    expect(header).toBe(`__Host-${PREVIEW_COOKIE}=1.2.abc; Path=/; Secure; HttpOnly; SameSite=Lax`);
    expect(header).not.toMatch(/Domain=/i);
  });

  it('reads the __Host- name, still honours the legacy name, and prefers __Host- when both are present', () => {
    expect(previewCookieEntry(req('__Host-bf_preview=new'))).toMatchObject({ value: 'new', legacy: false });
    expect(previewCookieEntry(req('bf_preview=old'))).toMatchObject({ value: 'old', legacy: true });
    expect(previewCookieEntry(req('bf_preview=old; __Host-bf_preview=new'))).toMatchObject({ value: 'new', legacy: false });
    expect(previewCookieEntry(req('other=1'))).toBeNull();
  });

  it('upgrades a legacy-only token to __Host- and expires the legacy cookie; nothing for a __Host- one', () => {
    expect(previewCookieUpgrade(previewCookieEntry(req('bf_preview=1.2.abc')))).toEqual([
      '__Host-bf_preview=1.2.abc; Path=/; Secure; HttpOnly; SameSite=Lax',
      'bf_preview=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0',
    ]);
    expect(previewCookieUpgrade(previewCookieEntry(req('__Host-bf_preview=1.2.abc')))).toEqual([]);
  });
});
