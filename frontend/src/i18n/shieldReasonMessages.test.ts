import { describe, expect, it } from 'vitest';
import { SHIELD_RULES } from '@seanhogg/builderforce-webcontainers/security';
import de from './messages/de.json';
import en from './messages/en.json';
import es from './messages/es.json';
import fr from './messages/fr.json';
import zh from './messages/zh.json';
import { shieldReasonKeyOf } from './useErrorMessage';

const CATALOGS = { en, zh, es, fr, de } as Record<string, unknown>;
const refusal = (reason: string) => ({ code: 'EBFWC_SHIELD', reason });

function lookup(catalog: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), catalog);
}

describe('Security Shield reason copy', () => {
  it.each(Object.keys(CATALOGS))('every reason code the runtime can emit has copy in %s', (locale) => {
    for (const code of Object.keys(SHIELD_RULES)) {
      const key = shieldReasonKeyOf(refusal(code));
      expect(key, code).not.toBeNull();
      const text = lookup(CATALOGS[locale], key!);
      expect(typeof text, `${locale}:${key}`).toBe('string');
      expect((text as string).length).toBeGreaterThan(10);
    }
  });

  it('holds no copy for a code the runtime does not emit', () => {
    const known = new Set(Object.keys(SHIELD_RULES).map((code) => shieldReasonKeyOf(refusal(code))!.split('.').pop()));
    for (const locale of Object.keys(CATALOGS)) {
      expect(Object.keys(lookup(CATALOGS[locale], 'runtimeShield.reason') as object).filter((k) => !known.has(k))).toEqual([]);
    }
  });

  it('reads a shield refusal by its shape, and nothing else', () => {
    expect(shieldReasonKeyOf(refusal('ingress.app_origin_required'))).toBe('runtimeShield.reason.ingressAppOriginRequired');
    expect(shieldReasonKeyOf(refusal('constructor'))).toBeNull();
    expect(shieldReasonKeyOf({ code: 'OTHER', reason: 'port.not_owner' })).toBeNull();
    expect(shieldReasonKeyOf(new Error('x'))).toBeNull();
    expect(shieldReasonKeyOf(null)).toBeNull();
  });
});
