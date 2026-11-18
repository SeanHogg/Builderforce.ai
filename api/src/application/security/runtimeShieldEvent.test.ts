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
  ])('refuses a credential key (%j)', (evidence, path) => {
    expect(findForbiddenEvidenceKey(evidence)).toBe(path);
  });

  it('refuses evidence nested deeper than the bound', () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i <= SHIELD_EVIDENCE_MAX_DEPTH; i += 1) deep = { n: deep };
    expect(findForbiddenEvidenceKey(deep)).not.toBeNull();
  });

  it('measures the stored UTF-8 size', () => {
    expect(evidenceByteLength({ a: 'é' })).toBe(JSON.stringify({ a: 'é' }).length + 1);
  });
});
