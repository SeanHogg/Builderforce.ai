import { describe, it, expect, vi } from 'vitest';
import { createBrowserAgentTransport } from './transport';

type ReqOpts = { method?: string; body?: string; headers?: Record<string, string> };

describe('createBrowserAgentTransport', () => {
  it('claim() maps the API envelope to a ClaimedDispatch', async () => {
    const request = vi.fn(async (_path: string, _opts?: ReqOpts) => ({
      dispatch: {
        dispatchId: 'd1', claimToken: 't', role: 'impl', model: 'anthropic/claude-3-haiku',
        input: 'do it', taskId: 5, ticketRunId: 'run1',
      },
    }));
    const t = createBrowserAgentTransport({ request: request as never });
    const claimed = await t.claim();
    expect(request).toHaveBeenCalledWith('/api/agent-runtime/claim', { method: 'POST', body: '{}' });
    expect(claimed).toEqual({
      dispatchId: 'd1', model: 'anthropic/claude-3-haiku', role: 'impl', input: 'do it', taskId: 5,
    });
  });

  it('claim() returns null when there is no work', async () => {
    const request = vi.fn(async (_path: string, _opts?: ReqOpts) => ({ dispatch: null }));
    const t = createBrowserAgentTransport({ request: request as never });
    expect(await t.claim()).toBeNull();
  });

  it('callModel() posts the OWN model to the gateway and returns the completion content', async () => {
    const request = vi.fn(async (_path: string, _opts?: ReqOpts) => ({
      choices: [{ message: { content: 'hello' } }],
    }));
    const t = createBrowserAgentTransport({ request: request as never });
    const out = await t.callModel({ model: 'anthropic/claude-3-haiku', prompt: 'hi' });
    expect(out).toBe('hello');
    const call = request.mock.calls[0]!;
    expect(call[0]).toBe('/v1/chat/completions');
    const body = JSON.parse(call[1]!.body!);
    expect(body.model).toBe('anthropic/claude-3-haiku');
    expect(body.messages[0]).toEqual({ role: 'user', content: 'hi' });
  });

  it('callModel() throws when the gateway returns no content', async () => {
    const request = vi.fn(async (_path: string, _opts?: ReqOpts) => ({ choices: [] }));
    const t = createBrowserAgentTransport({ request: request as never });
    await expect(t.callModel({ model: 'm', prompt: 'p' })).rejects.toThrow(/no completion/);
  });

  it('report() posts the terminal result to the dispatch result endpoint', async () => {
    const request = vi.fn(async (_path: string, _opts?: ReqOpts) => ({ ok: true }));
    const t = createBrowserAgentTransport({ request: request as never });
    await t.report('d1', { status: 'completed', output: 'done' });
    const call = request.mock.calls[0]!;
    expect(call[0]).toBe('/api/agent-runtime/d1/result');
    expect(JSON.parse(call[1]!.body!)).toEqual({ status: 'completed', output: 'done' });
  });
});
