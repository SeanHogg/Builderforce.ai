/**
 * Signed per-app worker egress policy ids (make.md §4 W10, control 6): bound to the origin key
 * derived from (project, application), carrying tenant/project and a key version, a 24 h TTL, a
 * subkey of JWT_SECRET, canonical payloads only, URL-safe and ≤ 512 chars. Anything absent,
 * malformed, non-canonical, tampered, expired or bound elsewhere resolves to the default.
 */
import { describe, expect, it } from 'vitest';
import { base64UrlDecode, base64UrlEncode, bytesToBase64Url } from '../../domain/shared/bytes';
import { hmacSign } from '../../infrastructure/crypto/hmac';
import { previewOriginKey } from './previewOriginKey';
import {
  DEFAULT_WORKER_EGRESS_POLICY, MAX_POLICY_ID_CHARS, MAX_POLICY_ORIGINS, mintWorkerEgressPolicyId,
  resolveWorkerEgressPolicy, WORKER_EGRESS_POLICY_TTL_SECONDS, WorkerEgressPolicyError,
} from './workerEgressPolicy';
import { previewOriginKeyOf } from '../../domain/shared/previewHosts';

const SECRET = 'test-secret';
const APP_A = 'app:42:0123456789abcdef';
const APP_B = 'app:43:0123456789abcdef';
const host = (key: string) => `${key}-preview.builderforce.ai`;
const binding = { tenantId: 7, projectId: 42, applicationId: APP_A, origins: ['https://api.example.com', 'wss://stream.example.com'] };
const nowSec = () => Math.floor(Date.now() / 1000);

/** Sign an arbitrary payload string exactly as the minter does (subkey, then the purpose prefix). */
async function signJson(json: string, secret = SECRET): Promise<string> {
  const p = base64UrlEncode(json);
  return `${p}.${bytesToBase64Url(await hmacSign(await hmacSign(secret, 'bfwc-egress-key'), `bfwc-egress:${p}`))}`;
}

describe('worker egress policy ids', () => {
  it('round-trips on the derived origin of its application, and is URL-safe and short', async () => {
    const { policy, expiresAt, originKey } = await mintWorkerEgressPolicyId(SECRET, binding);
    expect(originKey).toBe('96c02ff6106da114d069c7a8eff3c26a'); // = the runtime's previewOriginKey('42', APP_A)
    expect(policy).toMatch(/^[A-Za-z0-9._~-]+$/);
    expect(policy.length).toBeLessThanOrEqual(MAX_POLICY_ID_CHARS);
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan((WORKER_EGRESS_POLICY_TTL_SECONDS - 60) * 1000);
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(WORKER_EGRESS_POLICY_TTL_SECONDS * 1000);
    expect(await resolveWorkerEgressPolicy(SECRET, policy, host(originKey)))
      .toEqual({ id: policy, connectSources: ['https://api.example.com', 'wss://stream.example.com'] });
  });

  it('signs version, tenant, project, derived key, application, origins and exp', async () => {
    const now = Date.UTC(2026, 10, 18);
    const { policy, originKey } = await mintWorkerEgressPolicyId(SECRET, binding, now);
    expect(JSON.parse(base64UrlDecode(policy.split('.')[0]!))).toEqual({
      v: 1, t: 7, p: 42, k: originKey, a: APP_A, o: ['https://api.example.com', 'wss://stream.example.com'],
      e: now / 1000 + WORKER_EGRESS_POLICY_TTL_SECONDS,
    });
  });

  it('a policy minted for project A does not verify on project B\'s host', async () => {
    const a = await mintWorkerEgressPolicyId(SECRET, binding);
    const keyB = await previewOriginKey('43', APP_B);
    expect(keyB).not.toBe(a.originKey);
    expect(await resolveWorkerEgressPolicy(SECRET, a.policy, host(keyB))).toBe(DEFAULT_WORKER_EGRESS_POLICY);
  });

  it('mints a policy with no declared origins (the default allowlist only), still bound', async () => {
    const { policy, originKey } = await mintWorkerEgressPolicyId(SECRET, { ...binding, origins: [] });
    expect(await resolveWorkerEgressPolicy(SECRET, policy, host(originKey))).toEqual({ id: policy, connectSources: [] });
  });

  it('serves the default when the host is not the bound app origin', async () => {
    const { policy, originKey } = await mintWorkerEgressPolicyId(SECRET, binding);
    for (const h of [host('f'.repeat(32)), 'preview.builderforce.ai', 'api.builderforce.ai', `${originKey}-preview.evil.com`, undefined, null]) {
      expect(await resolveWorkerEgressPolicy(SECRET, policy, h)).toBe(DEFAULT_WORKER_EGRESS_POLICY);
    }
  });

  it('serves the default once expired, including at exactly exp, and honours it just before', async () => {
    const minted = Date.now() - (WORKER_EGRESS_POLICY_TTL_SECONDS + 60) * 1000;
    const { policy, originKey } = await mintWorkerEgressPolicyId(SECRET, binding, minted);
    expect(await resolveWorkerEgressPolicy(SECRET, policy, host(originKey))).toBe(DEFAULT_WORKER_EGRESS_POLICY);
    const exp = (Math.floor(minted / 1000) + WORKER_EGRESS_POLICY_TTL_SECONDS) * 1000;
    expect(await resolveWorkerEgressPolicy(SECRET, policy, host(originKey), exp)).toBe(DEFAULT_WORKER_EGRESS_POLICY);
    expect((await resolveWorkerEgressPolicy(SECRET, policy, host(originKey), exp - 1)).id).toBe(policy);
  });

  it('serves the default for a tampered, foreign-secret, malformed or absent id', async () => {
    const { policy, originKey } = await mintWorkerEgressPolicyId(SECRET, binding);
    const [payload, mac] = policy.split('.') as [string, string];
    const widened = base64UrlEncode(JSON.stringify({ ...JSON.parse(base64UrlDecode(payload)), o: ['https://evil.example.com'] }));
    const flipped = mac.slice(0, -1) + (mac.endsWith('A') ? 'B' : 'A');
    for (const presented of [`${widened}.${mac}`, `${payload}.${flipped}`, `${payload}.${'a'.repeat(64)}`, payload, '', null,
      'x'.repeat(MAX_POLICY_ID_CHARS + 1)]) {
      expect(await resolveWorkerEgressPolicy(SECRET, presented, host(originKey))).toBe(DEFAULT_WORKER_EGRESS_POLICY);
    }
    expect(await resolveWorkerEgressPolicy('another-secret', policy, host(originKey))).toBe(DEFAULT_WORKER_EGRESS_POLICY);
    expect(await resolveWorkerEgressPolicy(undefined, policy, host(originKey))).toBe(DEFAULT_WORKER_EGRESS_POLICY);
  });

  it('refuses a correctly signed payload that is not canonical: duplicate, extra, reordered keys or another version', async () => {
    const k = await previewOriginKey('42', APP_A);
    const e = nowSec() + 600;
    const canonical = `{"v":1,"t":7,"p":42,"k":"${k}","a":"${APP_A}","o":[],"e":${e}}`;
    expect((await resolveWorkerEgressPolicy(SECRET, await signJson(canonical), host(k))).id).not.toBeNull();
    for (const json of [
      `{"v":1,"t":7,"p":42,"k":"${k}","a":"${APP_A}","o":[],"o":["https://evil.example.com"],"e":${e}}`,
      `{"v":1,"t":7,"p":42,"k":"${k}","k":"${k}","a":"${APP_A}","o":[],"e":${e}}`,
      `{"v":1,"t":7,"p":42,"k":"${k}","a":"${APP_A}","o":[],"e":${e},"x":1}`,
      `{"t":7,"v":1,"p":42,"k":"${k}","a":"${APP_A}","o":[],"e":${e}}`,
      `{"v":2,"t":7,"p":42,"k":"${k}","a":"${APP_A}","o":[],"e":${e}}`,
    ]) {
      expect(await resolveWorkerEgressPolicy(SECRET, await signJson(json), host(k))).toBe(DEFAULT_WORKER_EGRESS_POLICY);
    }
  });

  it('refuses a signed payload whose key is not the one derived from its project and application', async () => {
    const forged = 'f'.repeat(32);
    const json = `{"v":1,"t":7,"p":42,"k":"${forged}","a":"${APP_A}","o":[],"e":${nowSec() + 600}}`;
    expect(await resolveWorkerEgressPolicy(SECRET, await signJson(json), host(forged))).toBe(DEFAULT_WORKER_EGRESS_POLICY);
  });

  it('uses a subkey: a MAC under JWT_SECRET itself does not verify', async () => {
    const k = await previewOriginKey('42', APP_A);
    const p = base64UrlEncode(`{"v":1,"t":7,"p":42,"k":"${k}","a":"${APP_A}","o":[],"e":${nowSec() + 600}}`);
    const direct = `${p}.${bytesToBase64Url(await hmacSign(SECRET, `bfwc-egress:${p}`))}`;
    expect(await resolveWorkerEgressPolicy(SECRET, direct, host(k))).toBe(DEFAULT_WORKER_EGRESS_POLICY);
  });

  it('re-validates signed origins: a platform host signed with the real key is still the default', async () => {
    const k = await previewOriginKey('42', APP_A);
    const signed = await signJson(`{"v":1,"t":7,"p":42,"k":"${k}","a":"${APP_A}","o":["https://preview.builderforce.ai"],"e":${nowSec() + 600}}`);
    expect(await resolveWorkerEgressPolicy(SECRET, signed, host(k))).toBe(DEFAULT_WORKER_EGRESS_POLICY);
  });

  it('refuses to mint for another project\'s application id, a disallowed origin, or too many origins', async () => {
    await expect(mintWorkerEgressPolicyId(SECRET, { ...binding, applicationId: APP_B })).rejects.toThrow();
    await expect(mintWorkerEgressPolicyId(SECRET, { ...binding, applicationId: 'web' })).rejects.toThrow();
    const bad = mintWorkerEgressPolicyId(SECRET, { ...binding, origins: ['https://api.builderforce.ai'] });
    const err = await bad.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkerEgressPolicyError);
    expect((err as Error).message).not.toContain('builderforce'); // generic: no origin text
    const many = Array.from({ length: MAX_POLICY_ORIGINS + 1 }, (_, i) => `https://h${i}.example.com`);
    await expect(mintWorkerEgressPolicyId(SECRET, { ...binding, origins: many })).rejects.toBeInstanceOf(WorkerEgressPolicyError);
  });

  it('reads the origin key only from an app-origin host', () => {
    const k = '0123456789abcdef0123456789abcdef';
    expect(previewOriginKeyOf(host(k))).toBe(k);
    expect(previewOriginKeyOf(host(k).toUpperCase())).toBe(k);
    expect(previewOriginKeyOf('preview.builderforce.ai')).toBeNull();
    expect(previewOriginKeyOf(`x.${host(k)}`)).toBeNull();
    // The second-level shape needs a certificate the zone does not have: never an app host.
    expect(previewOriginKeyOf(`${k}.preview.builderforce.ai`)).toBeNull();
    expect(previewOriginKeyOf(`${k}-preview.evil.com`)).toBeNull();
    expect(previewOriginKeyOf(`${k.slice(1)}-preview.builderforce.ai`)).toBeNull();
  });
});
