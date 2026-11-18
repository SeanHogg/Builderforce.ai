import { describe, expect, it } from 'vitest';
import { SHIELD_RULES } from '@seanhogg/builderforce-webcontainers/security';
import {
  evidenceByteLength, findForbiddenEvidenceKey, SHIELD_BLOCKING_ACTIONS, SHIELD_CATEGORIES, SHIELD_EVIDENCE_MAX_DEPTH, SHIELD_REASON_CODES,
  SHIELD_REASON_POLICY,
} from './runtimeShieldEvent';

describe('runtime shield evidence redaction', () => {
  it('accepts redacted evidence', () => {
    expect(findForbiddenEvidenceKey({ method: 'POST', path: '/api/orders', bodyBytes: 2_000_000, headers: ['content-type'] })).toBeNull();
  });

  it.each([
    [{ password: '***' }, 'password'],
    [{ request: { headers: { Cookie: 'a=b' } } }, 'request.headers.Cookie'],
    [{ accessToken: 'x' }, 'accessToken'],
    [{ list: [{ ok: 1 }, { 'x-api-key': 'k' }] }, 'list.1.x-api-key'],
    [{ Authorization: 'Bearer' }, 'Authorization'],
    [{ clientSecret: 's' }, 'clientSecret'],
    [{ pass: 'x' }, 'pass'],
    [{ db_pass: 'x' }, 'db_pass'],
    [{ 'pass-hash': 'x' }, 'pass-hash'],
    [{ passwd: 'x' }, 'passwd'],
    [{ userPassword: 'x' }, 'userPassword'],
    [{ passphrase: 'x' }, 'passphrase'],
    [{ PWD: 'x' }, 'PWD'],
  ])('refuses a credential key (%j)', (evidence, path) => {
    expect(findForbiddenEvidenceKey(evidence)).toBe(path);
  });

  it.each(['bypass', 'bypassed', 'compass', 'passage', 'passenger', 'surpass', 'trespass'])(
    'accepts %s, which only contains "pass"', (key) => {
      expect(findForbiddenEvidenceKey({ [key]: true })).toBeNull();
    },
  );

  it('refuses evidence nested deeper than the bound', () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i <= SHIELD_EVIDENCE_MAX_DEPTH; i += 1) deep = { n: deep };
    expect(findForbiddenEvidenceKey(deep)).not.toBeNull();
  });

  it('measures the stored UTF-8 size', () => {
    expect(evidenceByteLength({ a: 'é' })).toBe(JSON.stringify({ a: 'é' }).length + 1);
  });
});

describe('reason-code parity with the runtime', () => {
  it('accepts every reason code the runtime can emit, and no other', () => {
    expect([...SHIELD_REASON_CODES].sort()).toEqual(Object.keys(SHIELD_RULES).sort());
  });

  it('knows every category the runtime files a code under', () => {
    for (const rule of Object.values(SHIELD_RULES)) expect(SHIELD_CATEGORIES).toContain(rule.category);
  });

  it('keeps telemetry-only codes below the incident floor', () => {
    for (const [code, rule] of Object.entries(SHIELD_RULES)) {
      if (!SHIELD_BLOCKING_ACTIONS.has(rule.action)) expect(SHIELD_REASON_POLICY[code as keyof typeof SHIELD_REASON_POLICY].severity).toBe('low');
    }
    expect(SHIELD_REASON_POLICY['ingress.shared_preview_origin'].severity).toBe('low');
    expect(SHIELD_REASON_POLICY['ingress.app_origin_mismatch'].severity).toBe('high');
  });
});
