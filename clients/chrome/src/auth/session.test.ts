import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createCredentialVault, isWrappedCredential } from './credentialVault';
import { createMemoryKeyValue } from '../platform/keyValue';
import { createSession, SESSION_CREDENTIAL_KEY } from './session';

const baseUrl = 'https://gateway.example.test';

describe('Chrome editor session', () => {
  it('migrates legacy credentials and shares the protected vault across contexts', async () => {
    const indexedDB = new IDBFactory();
    const key = 'fixture-key';
    const storage = createMemoryKeyValue({ [SESSION_CREDENTIAL_KEY]: key });
    const deps = { storage, baseUrl, fetch: vi.fn(), now: () => 0 };
    const panel = createSession({ ...deps, vault: createCredentialVault(indexedDB) });
    await panel.ready();
    const saved = await storage.get(SESSION_CREDENTIAL_KEY);
    expect(isWrappedCredential(saved)).toBe(true);
    expect(JSON.stringify(saved)).not.toContain(key);
    const worker = createSession({ ...deps, vault: createCredentialVault(indexedDB) });
    expect(await worker.key()).toBe(key);

    await panel.signIn({ accessKey: 'replacement-fixture', tenantId: 8 });
    const written = await storage.get(SESSION_CREDENTIAL_KEY);
    expect(isWrappedCredential(written)).toBe(true);
    expect(JSON.stringify(written)).not.toContain('replacement-fixture');
    await expect.poll(() => worker.key()).toBe('replacement-fixture');
  });

  it('exchanges the stored key, caches its tenant token, and refreshes when forced', async () => {
    const fetch = vi.fn<Parameters<typeof createSession>[0]['fetch']>()
      .mockImplementationOnce(async () => Response.json({ token: 'initial', tenantId: 7, userId: 'member' }))
      .mockImplementationOnce(async () => Response.json({ token: 'refreshed', tenantId: 7, userId: 'member' }));
    const storage = createMemoryKeyValue({ [SESSION_CREDENTIAL_KEY]: 'editor-key', 'session.tenantId': 7, 'session.userId': 'member' });
    const session = createSession({ storage, baseUrl, fetch, now: () => 0 });

    expect(await session.jwt()).toBe('initial');
    expect(await session.jwt()).toBe('initial');
    expect(await session.jwt(true)).toBe('refreshed');
    expect(session.scope()).toBe('tenant:7');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]).toEqual([`${baseUrl}/api/auth/tenant-api-key-token`, expect.objectContaining({ body: '{"apiKey":"editor-key"}' })]);
  });

  it('keeps the key when offline and clears it on an explicit refusal', async () => {
    const fetch = vi.fn<Parameters<typeof createSession>[0]['fetch']>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const storage = createMemoryKeyValue({ [SESSION_CREDENTIAL_KEY]: 'editor-key' });
    const session = createSession({ storage, baseUrl, fetch, now: () => 0 });

    expect(await session.jwt()).toBeNull();
    expect(await session.key()).toBe('editor-key');
    expect(await session.jwt()).toBeNull();
    expect(await session.key()).toBeNull();
  });

  it('keeps the selected workspace across contexts and refuses mismatched tokens', async () => {
    const fetch = vi.fn<Parameters<typeof createSession>[0]['fetch']>()
      .mockImplementationOnce(async () => Response.json({ token: 'base', tenantId: 7, userId: 'member' }))
      .mockImplementationOnce(async () => Response.json({ token: 'wrong', tenantId: 9 }))
      .mockImplementationOnce(async () => Response.json({ token: 'base', tenantId: 7, userId: 'member' }))
      .mockImplementationOnce(async () => Response.json({ token: 'switched', tenantId: 8 }))
      .mockImplementationOnce(async () => Response.json({ token: 'base', tenantId: 7, userId: 'member' }))
      .mockImplementationOnce(async () => Response.json({ token: 'refreshed', tenantId: 8 }));
    const storage = createMemoryKeyValue({ [SESSION_CREDENTIAL_KEY]: 'editor-key', 'session.tenantId': 7 });
    const deps = { storage, baseUrl, fetch, now: () => 0 };
    const session = createSession(deps);

    expect(await session.switchWorkspace(8)).toBe(false);
    expect(session.scope()).toBe('tenant:7');
    expect(await session.switchWorkspace(8)).toBe(true);
    expect(session.scope()).toBe('tenant:8');

    const worker = createSession(deps);
    expect(await worker.jwt()).toBe('refreshed');
    expect(worker.scope()).toBe('tenant:8');
    expect(fetch.mock.calls[5]).toEqual([`${baseUrl}/api/auth/workspace-token`, expect.objectContaining({ body: '{"tenantId":8}' })]);
  });

  it('parks a selected workspace on a mint refusal without sending the base token', async () => {
    const fetch = vi.fn<Parameters<typeof createSession>[0]['fetch']>()
      .mockImplementationOnce(async () => Response.json({ token: 'base', tenantId: 7 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    const storage = createMemoryKeyValue({ [SESSION_CREDENTIAL_KEY]: 'editor-key', 'session.tenantId': 8 });
    const session = createSession({ storage, baseUrl, fetch, now: () => 0 });
    expect(await session.jwt()).toBeNull();
    expect(session.scope()).toBe('tenant:8');
    expect(await session.key()).toBe('editor-key');
  });
});
