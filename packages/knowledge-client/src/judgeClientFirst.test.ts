import { describe, expect, it, vi } from 'vitest';
import type { NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { createKnowledgeClient } from './client.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const req = { kind: 'extract' as const, items: [{ ref: 'src:a' as NodeRef, text: 'a claim', sourceHash: 'h1' }] };

function recorder() {
  const bodies: unknown[] = [];
  const fetch = async (_p: string, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return json({ extract: [], invalid: 0 }); };
  return { bodies, fetch };
}

describe('judge with judgeClientFirst', () => {
  it('posts the lent clientResult beside kind and items', async () => {
    const { bodies, fetch } = recorder();
    const cr = { json: { extract: [] }, provenance: { engine: 'browser', model: 'm' } };
    const client = createKnowledgeClient({ fetch, projectId: 1, judgeClientFirst: (_r, send) => send(cr) });
    await client.judgement.judge(req);
    expect(bodies).toEqual([{ kind: 'extract', items: req.items, clientResult: cr }]);
  });

  it('posts the unchanged body when nothing is lent, or the host declines', async () => {
    const { bodies, fetch } = recorder();
    await createKnowledgeClient({ fetch, projectId: 1 }).judgement.judge(req);
    await createKnowledgeClient({ fetch, projectId: 1, judgeClientFirst: (_r, send) => send() }).judgement.judge(req);
    expect(bodies).toEqual([{ kind: 'extract', items: req.items }, { kind: 'extract', items: req.items }]);
  });

  it('surfaces the 400 invalid_client_result as an error the helper recognises', async () => {
    const fetch = vi.fn(async () => json({ error: 'invalid_client_result' }, 400));
    const client = createKnowledgeClient({ fetch, projectId: 1, judgeClientFirst: (_r, send) => send({ json: {} }) });
    await expect(client.judgement.judge(req)).rejects.toMatchObject({ status: 400, message: 'invalid_client_result' });
  });
});
