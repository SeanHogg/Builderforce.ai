import { describe, expect, it, vi } from 'vitest';
import { fetchOpenPullRequests, reconciliationRequesterId } from './prReconciliationService';

const prNode = (number: number, checkName: string, conclusion: string) => ({
  number, title: `Task #${number}: work`, body: '', url: `https://github.com/acme/app/pull/${number}`,
  isDraft: false, headRefName: `builderforce/task-${number}`, baseRefName: 'main', headRefOid: `sha-${number}`,
  createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-02T00:00:00Z',
  mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', changedFiles: 1, additions: 2, deletions: 1,
  author: { login: 'agent' },
  commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [
    { __typename: 'CheckRun', name: checkName, status: 'COMPLETED', conclusion, detailsUrl: 'https://checks.test/1' },
  ] } } } }] },
});

describe('GitHub PR reconciliation collector', () => {
  it('never writes a machine JWT subject into the human requested_by foreign key', () => {
    expect(reconciliationRequesterId('agentHost:mcp', { kind: 'agent_host', agentHostId: null })).toBeNull();
    expect(reconciliationRequesterId('user-123', undefined)).toBe('user-123');
    expect(reconciliationRequesterId(undefined, undefined)).toBeNull();
  });

  it('batches and paginates the complete open-PR inventory with check evidence', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { repository: { pullRequests: {
        pageInfo: { hasNextPage: true, endCursor: 'page-2' }, nodes: [prNode(1, 'CI', 'SUCCESS')],
      } } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { repository: { pullRequests: {
        pageInfo: { hasNextPage: false, endCursor: null }, nodes: [prNode(2, 'Workers Builds: builderforce-frontend', 'FAILURE')],
      } } } }), { status: 200 }));

    const rows = await fetchOpenPullRequests('not-a-real-token', 'acme', 'app', 'github.com', fetchFn);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.checks[0]).toMatchObject({ name: 'Workers Builds: builderforce-frontend', state: 'FAILURE' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const firstRequest = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body));
    expect(firstRequest.query).toContain('pullRequests(first: 25');
    expect(firstRequest.query).not.toMatch(/\btitle\s+body\s+url\b/);
    expect(JSON.parse(String(fetchFn.mock.calls[1]?.[1]?.body)).variables.cursor).toBe('page-2');
  });

  it('surfaces GitHub HTTP response details as a readable error without exposing credentials', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('rate limit exceeded', { status: 403 }));
    await expect(fetchOpenPullRequests('secret-token', 'acme', 'app', 'github.com', fetchFn))
      .rejects.toThrow('GitHub GraphQL returned HTTP 403');
    const request = fetchFn.mock.calls[0]?.[1];
    expect(String(request?.body)).not.toContain('secret-token');
  });

  it('surfaces GraphQL errors rather than silently returning an incomplete inventory', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: 'Something failed' }] }), { status: 200 }));
    await expect(fetchOpenPullRequests('token', 'acme', 'app', 'github.com', fetchFn)).rejects.toThrow('Something failed');
  });
});
