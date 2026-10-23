import { describe, expect, it, vi } from 'vitest';
import { citedPathAnchors, projectMemoryHooks, type ProjectMemoryRequest } from './evermindMemory';

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

type Calls = { mock: { calls: Array<[string, { body: string }]> } };

describe('projectMemoryHooks.cacheAnswer — file anchors (defect 10)', () => {
  it('sends the files the run read, so the server can drop the answer when one changes', async () => {
    const request = vi.fn(async () => ({})) as unknown as ProjectMemoryRequest;
    projectMemoryHooks(42, request, 7).cacheAnswer?.('q?', 'a.', undefined, [{ path: 'api/src/auth.ts' }]);
    await Promise.resolve();
    const [, init] = (request as unknown as Calls).mock.calls[0]!;
    expect(JSON.parse(init.body).fileAnchors).toEqual([{ path: 'api/src/auth.ts' }]);
  });

  it('falls back to the paths the answer cites when the run passed none', async () => {
    const request = vi.fn(async () => ({})) as unknown as ProjectMemoryRequest;
    projectMemoryHooks(42, request, 7).cacheAnswer?.('how does auth work?', 'It lives in `api/src/auth.ts:40` and src/db/client.ts.');
    await Promise.resolve();
    const [, init] = (request as unknown as Calls).mock.calls[0]!;
    expect(JSON.parse(init.body).fileAnchors).toEqual([{ path: 'api/src/auth.ts' }, { path: 'src/db/client.ts' }]);
  });

  it('sends no anchors when there are none to send', async () => {
    const request = vi.fn(async () => ({})) as unknown as ProjectMemoryRequest;
    projectMemoryHooks(42, request, 7).cacheAnswer?.('q?', 'Plain prose, and/or v1.2 — no files.');
    await Promise.resolve();
    const [, init] = (request as unknown as Calls).mock.calls[0]!;
    expect(JSON.parse(init.body).fileAnchors).toBeUndefined();
  });
});

describe('citedPathAnchors', () => {
  it('takes repo paths with a directory and an extension, never prose or URLs', () => {
    expect(citedPathAnchors('See https://example.com/a/b.js and ./web/app.tsx, then (lib/x.py).')).toEqual([
      { path: 'web/app.tsx' },
      { path: 'lib/x.py' },
    ]);
    expect(citedPathAnchors('and/or, v1.2, README')).toEqual([]);
  });
});
