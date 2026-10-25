import { describe, expect, it, vi } from 'vitest';
import { readChatRunHistory, readChatTicketLinks, type ChatStateGet } from './chatStateReads';

/** The ONE reader of a chat's tickets and runs — the panel adapter and the VS Code
 *  context pack both read through it, each with its own authed GET. */
describe('chat state reads', () => {
  it('reads the tickets route and unwraps its list', async () => {
    const get = vi.fn(async () => ({ tickets: [{ kind: 'task', ref: '7' }] })) as unknown as ChatStateGet;
    expect(await readChatTicketLinks(get, 12)).toEqual([{ kind: 'task', ref: '7' }]);
    expect(get).toHaveBeenCalledWith('/api/brain/chats/12/tickets');
  });

  it('an empty or missing body is no tickets', async () => {
    expect(await readChatTicketLinks((async () => undefined) as ChatStateGet, 1)).toEqual([]);
    expect(await readChatTicketLinks((async () => ({})) as unknown as ChatStateGet, 1)).toEqual([]);
  });

  it('reads the runs route as the server sends it, and leaves a failure to the caller', async () => {
    const history = { linkedRunnableTickets: 1, runs: [{ executionId: 3 }] };
    const get = vi.fn(async () => history) as unknown as ChatStateGet;
    expect(await readChatRunHistory(get, 5)).toBe(history);
    expect(get).toHaveBeenCalledWith('/api/brain/chats/5/runs');
    const failing = (async () => { throw new Error('502'); }) as ChatStateGet;
    await expect(readChatRunHistory(failing, 5)).rejects.toThrow('502');
  });
});
