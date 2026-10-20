import { describe, expect, it, vi } from 'vitest';
import { projectMemoryHooks, type ProjectMemoryRequest } from './evermindMemory';

describe('projectMemoryHooks.cacheAnswer', () => {
  it('names the chat, so the server prices and gates the cached answer from its own records', async () => {
    const request = vi.fn(async () => ({})) as unknown as ProjectMemoryRequest & ReturnType<typeof vi.fn>;
    const hooks = projectMemoryHooks(42, request, 7, 'web');
    hooks.cacheAnswer?.('q?', 'a.', { model: 'm', promptTokens: 1, completionTokens: 2 });
    await Promise.resolve();
    const [path, init] = (request as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[0]!;
    expect(path).toBe('/api/projects/42/answer');
    expect(JSON.parse(init.body)).toMatchObject({ question: 'q?', answer: 'a.', chatId: 7 });
  });

  it('sends no chat id for a local-first (negative) chat', async () => {
    const request = vi.fn(async () => ({})) as unknown as ProjectMemoryRequest;
    projectMemoryHooks(42, request, -5).cacheAnswer?.('q?', 'a.');
    await Promise.resolve();
    const [, init] = (request as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[0]!;
    expect(JSON.parse(init.body).chatId).toBeUndefined();
  });
});
