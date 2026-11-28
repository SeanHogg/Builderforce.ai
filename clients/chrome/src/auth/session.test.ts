import { describe, expect, it, vi } from 'vitest';
import { createMemoryKeyValue } from '../platform/keyValue';
import { createSession, SESSION_CREDENTIAL_KEY } from './session';

const baseUrl = 'https://gateway.example.test';

describe('Chrome editor session', () => {
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
});
