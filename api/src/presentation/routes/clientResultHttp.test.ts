/**
 * The HTTP admission of `clientResult` (PRD 42 Part D): absent ⇒ nothing; invalid ⇒ 400
 * `invalid_client_result`; valid ⇒ the value. And the one-chunk SSE the streamed SOP
 * draft consumer already parses.
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { CLIENT_SUMMARY_SPEC } from '../../application/llm/clientResult';
import { admitBodyClientResult, admitClientResult, clientTextAsSseResponse } from './clientResultHttp';

const provenance = { engine: 'browser', model: 'gemini-nano' };

function app() {
  const a = new Hono();
  a.post('/', async (c) => {
    const { client, rejection } = await admitBodyClientResult(c as never, CLIENT_SUMMARY_SPEC);
    return rejection ?? c.json({ client: client ?? null });
  });
  return a;
}
const post = (body?: unknown) => app().request('/', { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) });

describe('admitBodyClientResult', () => {
  it('admits nothing when the body has no clientResult (or no body at all)', async () => {
    expect(await (await post()).json()).toEqual({ client: null });
    expect(await (await post({})).json()).toEqual({ client: null });
  });

  it('admits a valid one', async () => {
    expect(await (await post({ clientResult: { text: 'summary', provenance } })).json()).toEqual({ client: { value: 'summary', provenance } });
  });

  it('answers 400 invalid_client_result with the reason for an invalid one', async () => {
    const res = await post({ clientResult: { text: 'x'.repeat(8_001), provenance } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_client_result', reason: 'text_too_long' });
  });
});

describe('admitClientResult', () => {
  it('returns no rejection and no client for an absent value', () => {
    expect(admitClientResult({ json: () => { throw new Error('unused'); } } as never, undefined, CLIENT_SUMMARY_SPEC)).toEqual({});
  });
});

describe('clientTextAsSseResponse', () => {
  it('is the OpenAI-compatible SSE the draft consumer parses: one content delta, then [DONE]', async () => {
    const res = clientTextAsSseResponse('# Title\nbody');
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const frames = (await res.text()).split('\n\n').filter(Boolean).map((f) => f.replace(/^data: /, ''));
    expect(frames).toHaveLength(2);
    expect(JSON.parse(frames[0]!)).toEqual({ choices: [{ delta: { content: '# Title\nbody' } }] });
    expect(frames[1]).toBe('[DONE]');
  });
});
