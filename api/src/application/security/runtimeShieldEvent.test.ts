import { describe, expect, it } from 'vitest';
import { evidenceByteLength, findForbiddenEvidenceKey, SHIELD_EVIDENCE_MAX_DEPTH } from './runtimeShieldEvent';

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
