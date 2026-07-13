import { describe, expect, it, vi, beforeEach } from 'vitest';

// Stub the free-pool proxy so the classifier is exercised without a real gateway call.
// Spread the ACTUAL module so real exports (readProxyChoice) keep working — only the
// proxy factory is overridden.
const completeMock = vi.fn();
vi.mock('./LlmProxyService', async (importActual) => ({
  ...(await importActual<typeof import('./LlmProxyService')>()),
  ideProxy: () => ({ complete: completeMock }),
}));

import { classifyTaskAction } from './classifyTask';

/** Build a minimal ProxyResult-shaped object with a chat-completion JSON body.
 *  Uses a REAL Response so `readProxyChoice`'s `.clone().json()` works as in production. */
function gatewayResponse(content: string, status = 200) {
  return { response: new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers: { 'content-type': 'application/json' } }) };
}

const env = {} as never;

describe('classifyTaskAction', () => {
  beforeEach(() => completeMock.mockReset());

  it('returns the schema-conforming label + confidence', async () => {
    completeMock.mockResolvedValue(gatewayResponse(JSON.stringify({ action_type: 'sql', confidence: 0.92 })));
    const r = await classifyTaskAction(env, { title: 'Add an index to the orders table' });
    expect(r).toEqual({ actionType: 'sql', confidence: 0.92 });
  });

  it('coerces an unknown label to "other"', async () => {
    completeMock.mockResolvedValue(gatewayResponse(JSON.stringify({ action_type: 'wizardry', confidence: 0.5 })));
    const r = await classifyTaskAction(env, { title: 'x' });
    expect(r.actionType).toBe('other');
  });

  it('clamps an out-of-range confidence into [0,1]', async () => {
    completeMock.mockResolvedValue(gatewayResponse(JSON.stringify({ action_type: 'docs', confidence: 5 })));
    expect((await classifyTaskAction(env, { title: 'x' })).confidence).toBe(1);
    completeMock.mockResolvedValue(gatewayResponse(JSON.stringify({ action_type: 'docs', confidence: -2 })));
    expect((await classifyTaskAction(env, { title: 'x' })).confidence).toBe(0);
  });

  it('garbage (non-JSON) content → other/0', async () => {
    completeMock.mockResolvedValue(gatewayResponse('not json at all'));
    expect(await classifyTaskAction(env, { title: 'x' })).toEqual({ actionType: 'other', confidence: 0 });
  });

  it('a gateway error status → other/0 (never blocks)', async () => {
    completeMock.mockResolvedValue(gatewayResponse('{}', 503));
    expect(await classifyTaskAction(env, { title: 'x' })).toEqual({ actionType: 'other', confidence: 0 });
  });

  it('a malformed gateway result → other/0 (outer catch, best-effort)', async () => {
    // No `.response` on the result → reading `.response.status` throws inside the
    // try; the outer catch must absorb it and never propagate.
    completeMock.mockResolvedValue({} as never);
    expect(await classifyTaskAction(env, { title: 'x' })).toEqual({ actionType: 'other', confidence: 0 });
  });

  it('the kill switch short-circuits without calling the gateway', async () => {
    const r = await classifyTaskAction({ LEARNED_ROUTING_ENABLED: '0' } as never, { title: 'x' });
    expect(r).toEqual({ actionType: 'other', confidence: 0 });
    expect(completeMock).not.toHaveBeenCalled();
  });
});
