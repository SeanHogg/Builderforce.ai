import { describe, expect, it, vi } from 'vitest';
import { createBrainRestPersistence, type BrainRestRequest } from './brainRestPersistence';
import type { ClientFirstHost } from './onDevice/clientFirst';

const messages = [
  { id: 1, role: 'user', content: 'hello', createdAt: '' },
  { id: 2, role: 'assistant', content: 'hi there', createdAt: '' },
];
const provenance = { engine: 'browser', model: 'gemini-nano' } as const;
const host = (summary: string | null): ClientFirstHost => ({
  tasks: {
    available: async () => new Set(['summarize']),
    summarize: async () => summary,
  } as never,
  provenance: () => provenance,
});

function persistence(clientFirst: ClientFirstHost | undefined, reject = false) {
  const posted: unknown[] = [];
  const request = vi.fn(async (path: string, init?: { method?: string; body?: BodyInit }) => {
    if (path.endsWith('/messages')) return { messages };
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    posted.push(body);
    if (body?.clientResult && reject) throw Object.assign(new Error('invalid_client_result'), { status: 400 });
    return { summary: 'server summary' };
  }) as unknown as BrainRestRequest;
  return { api: createBrainRestPersistence({ baseUrl: 'http://x', request, getToken: () => null, ...(clientFirst ? { clientFirst } : {}) }), posted };
}

describe('summarizeChat client-first', () => {
  it('posts the on-device summary as clientResult', async () => {
    const { api, posted } = persistence(host('device summary'));
    await api.summarizeChat(7);
    expect(posted).toEqual([{ clientResult: { text: 'device summary', provenance } }]);
  });

  it('posts a bare request when the device declines or no port is lent', async () => {
    const declined = persistence(host(null));
    await declined.api.summarizeChat(7);
    expect(declined.posted).toEqual([undefined]);
    const none = persistence(undefined);
    await none.api.summarizeChat(7);
    expect(none.posted).toEqual([undefined]);
  });

  it('retries once without the result when the server rejects it', async () => {
    const { api, posted } = persistence(host('device summary'), true);
    expect(await api.summarizeChat(7)).toEqual({ summary: 'server summary' });
    expect(posted).toEqual([{ clientResult: { text: 'device summary', provenance } }, undefined]);
  });
});
