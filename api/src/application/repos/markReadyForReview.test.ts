import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCreatePrRequest, markReadyForReview } from './createPullRequest';

const base = { host: null, owner: 'o', repo: 'r', token: 't', number: 5 };
afterEach(() => vi.unstubAllGlobals());

function stub(...replies: Array<[number, unknown]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const [status, body] = replies.shift() ?? [500, {}];
    return new Response(JSON.stringify(body), { status });
  }));
  return calls;
}

describe('draft support', () => {
  it('sends draft on GitHub and a Draft: title on GitLab', () => {
    const pr = { host: null, owner: 'o', repo: 'r', token: 't', head: 'h', base: 'main', title: 'T', body: 'b', draft: true };
    expect(buildCreatePrRequest({ ...pr, provider: 'github' }).body).toMatchObject({ draft: true });
    expect(buildCreatePrRequest({ ...pr, provider: 'gitlab' }).body).toMatchObject({ title: 'Draft: T' });
    expect(buildCreatePrRequest({ ...pr, provider: 'github', draft: false }).body).not.toHaveProperty('draft');
    // Bitbucket cannot be taken out of draft from here, so it is never opened as one.
    expect(buildCreatePrRequest({ ...pr, provider: 'bitbucket' }).body).not.toHaveProperty('draft');
  });
});

describe('markReadyForReview', () => {
  it('GitHub: reads the node id, then runs the GraphQL mutation', async () => {
    const calls = stub([200, { node_id: 'PR_node' }], [200, { data: {} }]);
    expect(await markReadyForReview({ ...base, provider: 'github' })).toEqual({ ok: true });
    expect(calls[1]!.url).toMatch(/\/graphql$/);
    expect(String(calls[1]!.init?.body)).toContain('markPullRequestReadyForReview');
    expect(String(calls[1]!.init?.body)).toContain('PR_node');
  });
  it('GitHub: a GraphQL error is a failure, not a throw', async () => {
    stub([200, { node_id: 'n' }], [200, { errors: [{ message: 'nope' }] }]);
    expect(await markReadyForReview({ ...base, provider: 'github' })).toMatchObject({ ok: false, reason: expect.stringContaining('nope') });
  });
  it('GitLab: removes the Draft: prefix, and leaves a ready title alone', async () => {
    const calls = stub([200, { title: 'Draft: Task' }], [200, {}]);
    expect(await markReadyForReview({ ...base, provider: 'gitlab' })).toEqual({ ok: true });
    expect(calls[1]!.init?.method).toBe('PUT');
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ title: 'Task' });
    const again = stub([200, { title: 'Task' }]);
    expect(await markReadyForReview({ ...base, provider: 'gitlab' })).toEqual({ ok: true });
    expect(again).toHaveLength(1);
  });
  it('GitHub: a PR that is already ready is left alone (no mutation), and the text is still applied', async () => {
    const calls = stub([200, { node_id: 'n', draft: false }], [200, {}]);
    const text = { title: 'Task #5: t', body: 'final' };
    expect(await markReadyForReview({ ...base, provider: 'github', text })).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.init?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual(text);
  });
  it('GitHub: a draft is marked ready, then retitled', async () => {
    const calls = stub([200, { node_id: 'n', draft: true }], [200, { data: {} }], [200, {}]);
    expect(await markReadyForReview({ ...base, provider: 'github', text: { title: 'T', body: 'B' } })).toEqual({ ok: true });
    expect(calls.map((c) => c.init?.method ?? 'GET')).toEqual(['GET', 'POST', 'PATCH']);
  });
  it('GitLab: sets the final title and description in the one update', async () => {
    const calls = stub([200, { title: 'Draft: Task' }], [200, {}]);
    expect(await markReadyForReview({ ...base, provider: 'gitlab', text: { title: 'Task #5: t', body: 'B' } })).toEqual({ ok: true });
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ title: 'Task #5: t', description: 'B' });
  });
  it('regression: Minor 4 - Bitbucket Cloud applies the final text instead of returning ok first', async () => {
    const calls = stub([200, {}]);
    expect(await markReadyForReview({ ...base, provider: 'bitbucket', text: { title: 'Task #5: t', body: 'B' } })).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ title: 'Task #5: t', description: 'B' });
  });
  it('regression: Minor 4 - Bitbucket Server reads the PR version first, and a refused update is a failure', async () => {
    const calls = stub([200, { version: 4, reviewers: [] }], [409, {}]);
    const out = await markReadyForReview({ ...base, host: 'bb.acme.com', provider: 'bitbucket', text: { title: 'T', body: 'B' } });
    expect(out).toMatchObject({ ok: false });
    expect(JSON.parse(String(calls[1]!.init?.body))).toMatchObject({ title: 'T', description: 'B', version: 4 });
  });
  it('Bitbucket: nothing to do', async () => {
    const calls = stub();
    expect(await markReadyForReview({ ...base, provider: 'bitbucket' })).toEqual({ ok: true });
    expect(calls).toHaveLength(0);
  });
});
