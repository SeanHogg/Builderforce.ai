import { describe, expect, it, vi } from 'vitest';
import { createBoardProvider, GitHubBoardProvider, JiraBoardProvider, type FetchLike } from './providers';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('GitHubBoardProvider', () => {
  it('normalizes issues, stamps source=github, skips PRs, and advances cursor', async () => {
    const fetchFn: FetchLike = vi.fn(async () =>
      jsonResponse([
        {
          number: 1,
          title: 'First',
          body: 'hello',
          html_url: 'https://github.com/o/r/issues/1',
          state: 'open',
          updated_at: '2024-01-01T00:00:01Z',
        },
        {
          number: 2,
          title: 'A PR',
          body: null,
          html_url: 'https://github.com/o/r/pull/2',
          state: 'open',
          updated_at: '2024-01-01T00:00:09Z',
          pull_request: { url: 'x' },
        },
      ]),
    );

    const provider = new GitHubBoardProvider(
      { credentials: { accessToken: 'tok' }, externalBoardId: 'o/r' },
      fetchFn,
    );

    const page = await provider.fetchTicketsSince(null);
    expect(page.tickets).toHaveLength(1); // PR skipped
    const t = page.tickets[0]!;
    expect(t.externalId).toBe('1');
    expect(t.source).toBe('github');
    expect(t.externalVersion).toBe('2024-01-01T00:00:01Z');
    expect(t.contentHash).toMatch(/^[0-9a-f]{8}$/);
    // cursor advances only over processed issues (PRs are skipped, so the
    // PR's later updated_at does NOT move the cursor — we must re-see that
    // number if it ever converts to an issue).
    expect(page.nextCursor).toBe('2024-01-01T00:00:01Z');
  });

  it('passes the since cursor in the query and throws on non-2xx', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toContain('since=2024-05-01T00%3A00%3A00Z');
      return jsonResponse({ message: 'boom' }, 500);
    });
    const provider = new GitHubBoardProvider(
      { credentials: { accessToken: 'tok' }, externalBoardId: 'o/r' },
      fetchFn,
    );
    await expect(provider.fetchTicketsSince('2024-05-01T00:00:00Z')).rejects.toThrow(/500/);
  });

  it('pushUpdate PATCHes only provided fields', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body));
      expect(sent).toEqual({ title: 'New title' });
      expect(init?.method).toBe('PATCH');
      return jsonResponse({}, 200);
    });
    const provider = new GitHubBoardProvider(
      { credentials: { accessToken: 'tok' }, externalBoardId: 'o/r' },
      fetchFn,
    );
    await provider.pushUpdate('1', { title: 'New title' });
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});

describe('JiraBoardProvider', () => {
  it('builds JQL with updated>=cursor and normalizes issues with source=jira', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body));
      expect(sent.jql).toContain('updated >= "2024-01-01T00:00:00Z"');
      expect(sent.jql).toContain('project = "PROJ"');
      return jsonResponse({
        issues: [
          {
            key: 'PROJ-7',
            self: 'https://x.atlassian.net/rest/api/3/issue/7',
            fields: { summary: 'Sum', description: 'Desc', updated: '2024-02-02T00:00:00.000+0000', status: { name: 'To Do' } },
          },
        ],
      });
    });

    const provider = new JiraBoardProvider(
      { credentials: { email: 'e@x.com', apiToken: 't' }, baseUrl: 'https://x.atlassian.net', externalBoardId: 'PROJ' },
      fetchFn,
    );

    const page = await provider.fetchTicketsSince('2024-01-01T00:00:00Z');
    expect(page.tickets).toHaveLength(1);
    const t = page.tickets[0]!;
    expect(t.externalId).toBe('PROJ-7');
    expect(t.source).toBe('jira');
    expect(t.state).toBe('To Do');
    expect(page.nextCursor).toBe('2024-02-02T00:00:00.000+0000');
  });
});

describe('createBoardProvider', () => {
  it('builds known providers and rejects unknown', () => {
    const f: FetchLike = async () => jsonResponse({});
    expect(createBoardProvider('github', { credentials: {}, externalBoardId: 'o/r' }, f)).toBeInstanceOf(GitHubBoardProvider);
    expect(createBoardProvider('jira', { credentials: {}, baseUrl: 'https://x' }, f)).toBeInstanceOf(JiraBoardProvider);
    expect(() => createBoardProvider('trello', { credentials: {} }, f)).toThrow(/Unsupported/);
  });
});
