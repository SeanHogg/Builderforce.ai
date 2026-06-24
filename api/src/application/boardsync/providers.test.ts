import { describe, expect, it, vi } from 'vitest';
import {
  createBoardProvider,
  GitHubBoardProvider,
  JiraBoardProvider,
  LinearBoardProvider,
  SentryBoardProvider,
  PagerDutyBoardProvider,
  FreshserviceBoardProvider,
  ServiceNowBoardProvider,
  MondayBoardProvider,
  AsanaBoardProvider,
  ClickUpBoardProvider,
  type FetchLike,
} from './providers';
import { BOARD_PROVIDER_IDS } from './providerCatalog';

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

describe('LinearBoardProvider', () => {
  it('filters by updatedAt+team, normalizes nodes with source=linear, advances cursor', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body));
      expect(sent.variables.filter.updatedAt).toEqual({ gte: '2024-01-01T00:00:00Z' });
      expect(sent.variables.filter.team).toEqual({ id: { eq: 'TEAM1' } });
      return jsonResponse({
        data: {
          issues: {
            nodes: [
              { id: 'iss_1', identifier: 'ENG-1', title: 'Fix', description: 'body', url: 'https://linear.app/x/issue/ENG-1', updatedAt: '2024-03-03T00:00:00Z', state: { name: 'In Progress' } },
            ],
          },
        },
      });
    });
    const p = new LinearBoardProvider({ credentials: { apiKey: 'lin_k' }, externalBoardId: 'TEAM1' }, fetchFn);
    const page = await p.fetchTicketsSince('2024-01-01T00:00:00Z');
    expect(page.tickets[0]!.externalId).toBe('iss_1');
    expect(page.tickets[0]!.source).toBe('linear');
    expect(page.tickets[0]!.fields.identifier).toBe('ENG-1');
    expect(page.nextCursor).toBe('2024-03-03T00:00:00Z');
  });

  it('throws on GraphQL errors', async () => {
    const fetchFn: FetchLike = async () => jsonResponse({ errors: [{ message: 'bad key' }] });
    const p = new LinearBoardProvider({ credentials: { apiKey: 'x' } }, fetchFn);
    await expect(p.fetchTicketsSince(null)).rejects.toThrow(/bad key/);
  });

  it('pushUpdate maps title/body to IssueUpdateInput', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body));
      expect(sent.variables.input).toEqual({ title: 'T', description: 'B' });
      return jsonResponse({ data: { issueUpdate: { success: true } } });
    });
    const p = new LinearBoardProvider({ credentials: { apiKey: 'x' } }, fetchFn);
    await p.pushUpdate('iss_1', { title: 'T', body: 'B' });
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});

describe('SentryBoardProvider', () => {
  it('filters in-code to cursor and stamps source=sentry', async () => {
    const fetchFn: FetchLike = async (url: string) => {
      expect(url).toContain('/api/0/projects/acme/web/issues/');
      return jsonResponse([
        { id: '100', shortId: 'WEB-1', title: 'TypeError', culprit: 'app.js', permalink: 'https://sentry.io/i/100', status: 'unresolved', lastSeen: '2024-05-02T00:00:00Z' },
        { id: '99', title: 'Old', status: 'resolved', lastSeen: '2024-04-01T00:00:00Z' },
      ]);
    };
    const p = new SentryBoardProvider({ credentials: { token: 't' }, externalBoardId: 'acme/web' }, fetchFn);
    const page = await p.fetchTicketsSince('2024-04-15T00:00:00Z');
    expect(page.tickets).toHaveLength(1); // the 2024-04-01 issue is <= cursor
    expect(page.tickets[0]!.externalId).toBe('100');
    expect(page.nextCursor).toBe('2024-05-02T00:00:00Z');
  });

  it('pushUpdate only sends status', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/api/0/issues/100/');
      expect(JSON.parse(String(init?.body))).toEqual({ status: 'resolved' });
      return jsonResponse({});
    });
    const p = new SentryBoardProvider({ credentials: { token: 't' } }, fetchFn);
    await p.pushUpdate('100', { state: 'resolved' });
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});

describe('PagerDutyBoardProvider', () => {
  it('sends since cursor and normalizes incidents with source=pagerduty', async () => {
    const fetchFn: FetchLike = async (url: string) => {
      expect(url).toContain('since=2024-01-01T00%3A00%3A00Z');
      expect(url).toContain('service_ids%5B%5D=SVC1');
      return jsonResponse({ incidents: [{ id: 'PINC', incident_number: 7, title: 'DB down', status: 'triggered', html_url: 'https://pd/PINC', created_at: '2024-06-01T00:00:00Z' }] });
    };
    const p = new PagerDutyBoardProvider({ credentials: { apiToken: 't' }, externalBoardId: 'SVC1' }, fetchFn);
    const page = await p.fetchTicketsSince('2024-01-01T00:00:00Z');
    expect(page.tickets[0]!.externalId).toBe('PINC');
    expect(page.tickets[0]!.source).toBe('pagerduty');
    expect(page.nextCursor).toBe('2024-06-01T00:00:00Z');
  });

  it('pushUpdate requires fromEmail and resolves', async () => {
    const noEmail = new PagerDutyBoardProvider({ credentials: { apiToken: 't' } }, async () => jsonResponse({}));
    await expect(noEmail.pushUpdate('PINC', { state: 'resolved' })).rejects.toThrow(/fromEmail/);

    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).From).toBe('me@x.com');
      expect(JSON.parse(String(init?.body)).incident.status).toBe('resolved');
      return jsonResponse({});
    });
    const p = new PagerDutyBoardProvider({ credentials: { apiToken: 't', fromEmail: 'me@x.com' } }, fetchFn);
    await p.pushUpdate('PINC', { state: 'resolved' });
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});

describe('FreshserviceBoardProvider', () => {
  it('maps numeric status and updated_since cursor', async () => {
    const fetchFn: FetchLike = async (url: string) => {
      expect(url).toContain('updated_since=2024-01-01T00%3A00%3A00Z');
      expect(url).toContain('order_type=asc');
      return jsonResponse({ tickets: [{ id: 42, subject: 'Printer', description_text: 'broken', status: 4, updated_at: '2024-02-02T00:00:00Z' }] });
    };
    const p = new FreshserviceBoardProvider({ credentials: { apiKey: 'k' }, baseUrl: 'https://acme.freshservice.com/' }, fetchFn);
    const page = await p.fetchTicketsSince('2024-01-01T00:00:00Z');
    expect(page.tickets[0]!.externalId).toBe('42');
    expect(page.tickets[0]!.state).toBe('resolved');
    expect(page.tickets[0]!.externalUrl).toBe('https://acme.freshservice.com/a/tickets/42');
  });
});

describe('ServiceNowBoardProvider', () => {
  it('builds sysparm_query with cursor + table default incident', async () => {
    const fetchFn: FetchLike = async (url: string) => {
      expect(url).toContain('/api/now/table/incident');
      expect(decodeURIComponent(url)).toContain('sys_updated_on>=2024-01-01 00:00:00^ORDERBYsys_updated_on');
      return jsonResponse({ result: [{ sys_id: 'abc', number: 'INC001', short_description: 'Outage', description: 'desc', state: 'New', sys_updated_on: '2024-02-02 00:00:00' }] });
    };
    const p = new ServiceNowBoardProvider({ credentials: { username: 'u', password: 'p' }, baseUrl: 'https://dev.service-now.com' }, fetchFn);
    const page = await p.fetchTicketsSince('2024-01-01 00:00:00');
    expect(page.tickets[0]!.externalId).toBe('abc');
    expect(page.tickets[0]!.title).toBe('Outage');
    expect(page.nextCursor).toBe('2024-02-02 00:00:00');
  });
});

describe('MondayBoardProvider', () => {
  it('filters items in-code by cursor and requires a board id', async () => {
    const fetchFn: FetchLike = async () =>
      jsonResponse({
        data: { boards: [{ items_page: { items: [
          { id: '1', name: 'Keep', updated_at: '2024-05-02T00:00:00Z', state: 'active' },
          { id: '2', name: 'Drop', updated_at: '2024-01-01T00:00:00Z', state: 'active' },
        ] } }] },
      });
    const p = new MondayBoardProvider({ credentials: { token: 't' }, externalBoardId: '555' }, fetchFn);
    const page = await p.fetchTicketsSince('2024-03-01T00:00:00Z');
    expect(page.tickets).toHaveLength(1);
    expect(page.tickets[0]!.externalId).toBe('1');

    const noBoard = new MondayBoardProvider({ credentials: { token: 't' } }, fetchFn);
    await expect(noBoard.fetchTicketsSince(null)).rejects.toThrow(/board id/);
  });
});

describe('AsanaBoardProvider', () => {
  it('normalizes tasks with completed→state and modified_since cursor', async () => {
    const fetchFn: FetchLike = async (url: string) => {
      expect(url).toContain('project=PRJ');
      expect(url).toContain('modified_since=2024-01-01T00%3A00%3A00Z');
      return jsonResponse({ data: [{ gid: 'g1', name: 'Task', notes: 'n', completed: true, modified_at: '2024-02-02T00:00:00Z', permalink_url: 'https://app.asana.com/0/g1' }] });
    };
    const p = new AsanaBoardProvider({ credentials: { accessToken: 't' }, externalBoardId: 'PRJ' }, fetchFn);
    const page = await p.fetchTicketsSince('2024-01-01T00:00:00Z');
    expect(page.tickets[0]!.externalId).toBe('g1');
    expect(page.tickets[0]!.state).toBe('completed');
  });
});

describe('ClickUpBoardProvider', () => {
  it('uses epoch-ms cursor + ascending order and normalizes tasks', async () => {
    const fetchFn: FetchLike = async (url: string) => {
      expect(url).toContain('/list/L1/task');
      expect(url).toContain('reverse=true');
      expect(url).toContain('date_updated_gt=1700000000000');
      return jsonResponse({ tasks: [{ id: 'c1', name: 'Card', description: 'd', status: { status: 'in progress' }, date_updated: '1700000500000', url: 'https://clickup/c1' }] });
    };
    const p = new ClickUpBoardProvider({ credentials: { token: 't' }, externalBoardId: 'L1' }, fetchFn);
    const page = await p.fetchTicketsSince('1700000000000');
    expect(page.tickets[0]!.externalId).toBe('c1');
    expect(page.tickets[0]!.state).toBe('in progress');
    expect(page.nextCursor).toBe('1700000500000');
  });
});

describe('provider pagination (full-drain within one sync)', () => {
  function withLink(body: unknown, link: string): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', Link: link } });
  }

  it('Linear follows pageInfo.endCursor across pages', async () => {
    let call = 0;
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body));
      call += 1;
      if (call === 1) {
        expect(sent.variables.after).toBeNull();
        return jsonResponse({ data: { issues: { nodes: [{ id: 'a', identifier: 'E-1', title: 't', url: 'u', updatedAt: '2024-01-01T00:00:00Z' }], pageInfo: { hasNextPage: true, endCursor: 'CUR' } } } });
      }
      expect(sent.variables.after).toBe('CUR');
      return jsonResponse({ data: { issues: { nodes: [{ id: 'b', identifier: 'E-2', title: 't2', url: 'u2', updatedAt: '2024-02-01T00:00:00Z' }], pageInfo: { hasNextPage: false } } } });
    });
    const p = new LinearBoardProvider({ credentials: { apiKey: 'k' } }, fetchFn);
    const page = await p.fetchTicketsSince(null);
    expect(page.tickets.map((t) => t.externalId)).toEqual(['a', 'b']);
    expect(page.nextCursor).toBe('2024-02-01T00:00:00Z');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('Asana follows next_page.offset across pages', async () => {
    let call = 0;
    const fetchFn = vi.fn(async (url: string) => {
      call += 1;
      if (call === 1) {
        expect(url).not.toContain('offset=');
        return jsonResponse({ data: [{ gid: '1', name: 'a', modified_at: '2024-01-01T00:00:00Z' }], next_page: { offset: 'OFF' } });
      }
      expect(url).toContain('offset=OFF');
      return jsonResponse({ data: [{ gid: '2', name: 'b', modified_at: '2024-02-01T00:00:00Z' }], next_page: null });
    });
    const p = new AsanaBoardProvider({ credentials: { accessToken: 't' }, externalBoardId: 'PRJ' }, fetchFn);
    const page = await p.fetchTicketsSince(null);
    expect(page.tickets.map((t) => t.externalId)).toEqual(['1', '2']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('monday follows items_page → next_items_page cursor', async () => {
    let call = 0;
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body));
      call += 1;
      if (call === 1) {
        expect(sent.query).toContain('items_page');
        return jsonResponse({ data: { boards: [{ items_page: { cursor: 'C1', items: [{ id: '1', name: 'a', updated_at: '2024-05-01T00:00:00Z', state: 'active' }] } }] } });
      }
      expect(sent.query).toContain('next_items_page');
      expect(sent.variables.cursor).toBe('C1');
      return jsonResponse({ data: { next_items_page: { cursor: null, items: [{ id: '2', name: 'b', updated_at: '2024-06-01T00:00:00Z', state: 'active' }] } } });
    });
    const p = new MondayBoardProvider({ credentials: { token: 't' }, externalBoardId: '9' }, fetchFn);
    const page = await p.fetchTicketsSince(null);
    expect(page.tickets.map((t) => t.externalId)).toEqual(['1', '2']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('Sentry follows the Link rel="next" cursor then stops', async () => {
    let call = 0;
    const next = '<https://sentry.io/a?cursor=0:0:1>; rel="previous"; results="false"; cursor="0:0:1", <https://sentry.io/a?cursor=0:100:0>; rel="next"; results="true"; cursor="0:100:0"';
    const end = '<https://sentry.io/a>; rel="next"; results="false"; cursor="x"';
    const fetchFn = vi.fn(async (url: string) => {
      call += 1;
      if (call === 1) {
        expect(url).not.toContain('cursor=');
        return withLink([{ id: '1', title: 'a', status: 'unresolved', lastSeen: '2024-05-01T00:00:00Z' }], next);
      }
      expect(url).toContain('cursor=0%3A100%3A0');
      return withLink([{ id: '2', title: 'b', status: 'unresolved', lastSeen: '2024-06-01T00:00:00Z' }], end);
    });
    const p = new SentryBoardProvider({ credentials: { token: 't' }, externalBoardId: 'o/p' }, fetchFn);
    const page = await p.fetchTicketsSince(null);
    expect(page.tickets.map((t) => t.externalId)).toEqual(['1', '2']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('Sentry stops early once a page drops at/under the cursor', async () => {
    const fetchFn = vi.fn(async () =>
      withLink(
        [
          { id: '3', title: 'new', status: 'unresolved', lastSeen: '2024-07-01T00:00:00Z' },
          { id: '2', title: 'old', status: 'resolved', lastSeen: '2024-01-01T00:00:00Z' },
        ],
        '<u>; rel="next"; results="true"; cursor="MORE"',
      ),
    );
    const p = new SentryBoardProvider({ credentials: { token: 't' }, externalBoardId: 'o/p' }, fetchFn);
    const page = await p.fetchTicketsSince('2024-03-01T00:00:00Z');
    expect(page.tickets.map((t) => t.externalId)).toEqual(['3']); // old one skipped, paging stops
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('createBoardProvider', () => {
  it('builds known providers and rejects unknown', () => {
    const f: FetchLike = async () => jsonResponse({});
    expect(createBoardProvider('github', { credentials: {}, externalBoardId: 'o/r' }, f)).toBeInstanceOf(GitHubBoardProvider);
    expect(createBoardProvider('jira', { credentials: {}, baseUrl: 'https://x' }, f)).toBeInstanceOf(JiraBoardProvider);
    expect(() => createBoardProvider('unknown_xyz', { credentials: {} }, f)).toThrow(/Unsupported/);
  });

  it('has a registry entry for every provider in the catalog', () => {
    const f: FetchLike = async () => jsonResponse({});
    for (const id of BOARD_PROVIDER_IDS) {
      expect(() => createBoardProvider(id, { credentials: {} }, f)).not.toThrow();
    }
  });
});
