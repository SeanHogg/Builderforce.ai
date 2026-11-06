import { describe, expect, it } from 'vitest';
import { BrainRequestError, chatErrorAction } from './chatError';
import { localTransport } from './localFirstTransport';

const endpoint = { baseUrl: 'https://api.kimi.ai/coding/v1', token: 't' };
const refuse = (status: number) => new Response(JSON.stringify({ error: 'bad key' }), { status });

describe('an account-backed runtime refusing its credential', () => {
  it('names the provider, so the 401 is not read as a BuilderForce session error', async () => {
    const transport = localTransport(endpoint, undefined, { runtime: 'kimi-code' });
    const err = await transport.mapError!(refuse(401));
    expect(err).toBeInstanceOf(BrainRequestError);
    expect(chatErrorAction(err)).toEqual({ kind: 'provider_sign_in', provider: 'kimi', label: 'Kimi Code' });
  });

  it('treats a 403 the same way', async () => {
    const transport = localTransport(endpoint, undefined, { runtime: 'kimi-code' });
    expect(chatErrorAction(await transport.mapError!(refuse(403)))?.kind).toBe('provider_sign_in');
  });

  it('keeps the gateway mapping for other statuses', async () => {
    const transport = localTransport(endpoint, undefined, { runtime: 'kimi-code' });
    const err = (await transport.mapError!(refuse(500))) as BrainRequestError;
    expect(err.status).toBe(500);
    expect(chatErrorAction(err)).toBeNull();
  });

  it('leaves a runtime with no account on the default mapping', () => {
    expect(localTransport({ baseUrl: 'http://localhost:11434/v1' }, undefined, { runtime: 'ollama' }).mapError).toBeUndefined();
  });

  it('a plain 401 is still a session error', () => {
    expect(chatErrorAction(new BrainRequestError('x', { status: 401 }))?.kind).toBe('auth');
  });
});
