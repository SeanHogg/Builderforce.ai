import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { trustEgressCa } from '../../../container/egressTrust.mjs';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'egress-trust-')); dirs.push(d); return d; };
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('trustEgressCa', () => {
  it('is a no-op when the platform CA is absent', () => {
    const env: Record<string, string | undefined> = { NODE_EXTRA_CA_CERTS: '/etc/cloudflare/certs/cloudflare-containers-ca.crt', GIT_SSL_CAINFO: '/keep/me' };
    expect(trustEgressCa(env, join(tmp(), 'missing.crt'))).toBeNull();
    expect(env.NODE_EXTRA_CA_CERTS).toBeUndefined();
    expect(env.GIT_SSL_CAINFO).toBe('/keep/me'); // other vars are only ever SET when the CA exists
  });

  it('builds a bundle (system roots + CA) and points the tools at it', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'ca.crt'), 'PLATFORM-CA');
    writeFileSync(join(dir, 'sys.crt'), 'SYSTEM-ROOTS');
    const env: Record<string, string | undefined> = {};
    const bundle = trustEgressCa(env, join(dir, 'ca.crt'), join(dir, 'sys.crt'), dir);
    expect(dirname(bundle!).startsWith(join(dir, 'bf-egress-ca-'))).toBe(true); // a fresh mkdtemp directory, not a fixed name
    expect(bundle!.endsWith('bundle.crt')).toBe(true);
    expect(readFileSync(bundle!, 'utf8')).toContain('SYSTEM-ROOTS');
    expect(readFileSync(bundle!, 'utf8')).toContain('PLATFORM-CA');
    expect(env.GIT_SSL_CAINFO).toBe(bundle);
    expect(env.NODE_EXTRA_CA_CERTS).toBe(join(dir, 'ca.crt'));
  });

  it('does not throw when the bundle cannot be written', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'ca.crt'), 'PLATFORM-CA');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env: Record<string, string | undefined> = {};
    expect(() => trustEgressCa(env, join(dir, 'ca.crt'), join(dir, 'sys.crt'), join(dir, 'no', 'such', 'dir'))).not.toThrow();
    expect(trustEgressCa(env, join(dir, 'ca.crt'), join(dir, 'sys.crt'), join(dir, 'no', 'such', 'dir'))).toBeNull();
    expect(env.GIT_SSL_CAINFO).toBeUndefined();
  });
});
