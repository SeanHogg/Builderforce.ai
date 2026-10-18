/**
 * The camelCase `/agentHosts/...` session-history path is an alias of the canonical
 * kebab `/agent-hosts/...` one: same handler, plus Deprecation + concrete successor Link.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', 4);
    await next();
  },
}));

import { createChatRoutes } from './chatRoutes';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';

const messages = [{ id: 1, role: 'user', content: 'hi', metadata: null, seq: 1, createdAt: null }];

describe('agent-host session history', () => {
  it('serves the canonical kebab path without deprecation headers', async () => {
    const db = fakeDb([[{ id: 10 }], messages]);
    const res = await createChatRoutes(db as unknown as Db).request('/agent-hosts/3/sessions/main/messages');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages });
    expect(res.headers.get('Deprecation')).toBeNull();
  });

  it('serves the camelCase alias from the same handler, naming the kebab successor', async () => {
    const db = fakeDb([[{ id: 10 }], messages]);
    const res = await createChatRoutes(db as unknown as Db).request('/agentHosts/3/sessions/main/messages');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages });
    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Link')).toBe('</api/agent-hosts/3/sessions/main/messages>; rel="successor-version"');
  });
});
