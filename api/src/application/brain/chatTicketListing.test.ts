import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * listTicketsForChat — filtering and paging.
 *
 * WHY THIS FILE EXISTS (the defect it locks): `chats.list_tickets` took only
 * `chatId`, so an agent asking "which tickets on this chat are still open?" got
 * the flat, unfiltered, unpaginated array of EVERY link. On a real chat
 * (#165 carries 100+) that payload truncates in the tool transport and the tail
 * is unrecoverable — the agent cannot page past the cut, cannot tell a truncated
 * page from a complete one, and has to classify every row itself. That is how
 * tickets get missed and a board silently drifts out of date.
 *
 * The fix adds status/kind/openOnly filters plus limit/offset on
 * `listTicketPageForChat`, which ALWAYS returns { tickets, total, matched, hasMore }
 * so a partial page is self-describing; `listTicketsForChat` stays the bare array.
 *
 * Locked here:
 *   • listTicketsForChat → a BARE ARRAY, byte-identical to the pre-change contract,
 *     so the UI rail and chats.resolve_hashtag keep working untouched
 *   • listTicketPageForChat → ALWAYS the envelope, even with no options
 *   • openOnly keeps work not in the closed class, and drops done/cancelled
 *   • a link whose target no longer exists stays OPEN (deleted ≠ finished)
 *   • status / kind filters, case-insensitively
 *   • limit/offset paging, matched vs total vs hasMore, and the clamp
 *   • the health batch still runs ONCE regardless of filters (batch promise)
 */

import { ChatTicketService } from './ChatTicketService';
import type { ChatTicketLink } from './ChatTicketService';
import { pageChatTickets, type ChatTicketPage } from './chatTicketListing';

// Strategy-tier health queries call resolveSegment(db, tenantId). Our fake DB
// can't serve that query, so mock it to return a stable segment id.
vi.mock('../../infrastructure/auth/segmentResolver', () => ({
  resolveSegment: vi.fn().mockResolvedValue('seg_default'),
}));

/** Results the fake hands back, in the order ChatTicketService asks for them. */
let queue: unknown[][] = [];
/** Every select the service issued — proves batching claims. */
let selectCount = 0;

function makeDb() {
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit', 'groupBy']) b[m] = () => b;
    (b as { then: unknown }).then = (resolve: (v: unknown[]) => void) => resolve(queue.shift() ?? []);
    return b;
  };
  return {
    select: () => { selectCount += 1; return builder(); },
  } as unknown as ConstructorParameters<typeof ChatTicketService>[0];
}

function service() {
  return new ChatTicketService(makeDb(), {} as never);
}

beforeEach(() => { queue = []; selectCount = 0; });

/**
 * listTicketsForChat runs: ownedChat → links → ONE ticketHealthBatch. Build the
 * queue so `rows` come back from the links query and then from the batch.
 */
function seed(rows: Array<{ id: number; status: string; taskType?: string }>) {
  const links = rows.map((r, i) => ({
    id: i + 1,
    tenantId: 1,
    chatId: 165,
    ticketKind: r.taskType ?? 'task',
    ticketRef: String(r.id),
    linkType: 'linked',
    createdBy: null,
    createdAt: new Date(2026, 0, i + 1),
  }));
  const tickets = rows.map((r) => ({
    id: r.id,
    title: `Ticket ${r.id}`,
    status: r.status,
    completedAt: null,
    taskType: r.taskType ?? 'task',
    parentTaskId: null,
  }));
  queue = [[{ id: 165, tenantId: 1 }], links, tickets];
}

function asArray(v: unknown): ChatTicketLink[] {
  expect(Array.isArray(v)).toBe(true);
  return v as ChatTicketLink[];
}

function asPage(v: unknown): ChatTicketPage {
  expect(Array.isArray(v)).toBe(false);
  expect(v).toMatchObject({ tickets: expect.any(Array) });
  return v as ChatTicketPage;
}

// ── backward compatibility: the pre-change contract ───────────────────────

describe('no options returns a bare array (pre-change contract preserved)', () => {
  it('is an array, not the paging envelope, so existing callers are untouched', async () => {
    seed([{ id: 1, status: 'todo' }, { id: 2, status: 'done' }]);
    const out = await service().listTicketsForChat(1, 165, 'user-1');
    const rows = asArray(out);
    expect(rows).toHaveLength(2);
  });

  it('returns EVERY link — no default limit is silently applied', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, status: 'todo' }));
    seed(many);
    const rows = asArray(await service().listTicketsForChat(1, 165, 'user-1'));
    // The whole 100+-link set, which is exactly what made the payload unusable.
    expect(rows).toHaveLength(120);
  });

  it('returns an empty array for a chat with no links', async () => {
    queue = [[{ id: 165, tenantId: 1 }], []];
    const rows = asArray(await service().listTicketsForChat(1, 165, 'user-1'));
    expect(rows).toEqual([]);
  });
});

// ── openOnly: the question this whole change exists to answer ─────────────

describe('openOnly', () => {
  it('keeps work not in the closed class and drops done', async () => {
    seed([
      { id: 1, status: 'todo' },
      { id: 2, status: 'done' },
      { id: 3, status: 'in_progress' },
      { id: 4, status: 'in_review' },
    ]);
    const page = asPage(await service().listTicketPageForChat(1, 165, 'user-1', { openOnly: true }));
    expect(page.tickets.map((t) => t.ref)).toEqual(['1', '3', '4']);
    expect(page.matched).toBe(3);
    expect(page.total).toBe(4);
  });

  it('drops cancelled and archived too — a cancelled ticket reads closed, not owed', async () => {
    seed([
      { id: 1, status: 'todo' },
      { id: 2, status: 'cancelled' },
      { id: 3, status: 'archived' },
    ]);
    const page = asPage(await service().listTicketPageForChat(1, 165, 'user-1', { openOnly: true }));
    expect(page.tickets.map((t) => t.ref)).toEqual(['1']);
  });

  it('keeps a link whose target no longer exists — deleted work is unresolved, not finished', async () => {
    // The link row resolves to no live ticket, so health comes back missing().
    // Treating that as done would silently drop real work off the open list and
    // let the board look cleaner than it is.
    queue = [
      [{ id: 165, tenantId: 1 }],
      [
        { id: 1, tenantId: 1, chatId: 165, ticketKind: 'task', ticketRef: '1', linkType: 'linked', createdBy: null, createdAt: new Date(2026, 0, 1) },
        { id: 2, tenantId: 1, chatId: 165, ticketKind: 'task', ticketRef: '2', linkType: 'linked', createdBy: null, createdAt: new Date(2026, 0, 2) },
      ],
      [{ id: 1, title: 'Still open', status: 'todo', completedAt: null, taskType: 'task', parentTaskId: null }],
    ];
    const page = asPage(await service().listTicketPageForChat(1, 165, 'user-1', { openOnly: true }));
    expect(page.tickets.map((t) => t.ref).sort()).toEqual(['1', '2']);
    const gone = page.tickets.find((t) => t.ref === '2')!;
    expect(gone.exists).toBe(false);
    expect(gone.label).toBe('(deleted)');
  });

  it('an empty open set is reported as a real answer, not an error', async () => {
    seed([{ id: 1, status: 'done' }, { id: 2, status: 'cancelled' }]);
    const page = asPage(await service().listTicketPageForChat(1, 165, 'user-1', { openOnly: true }));
    expect(page.tickets).toEqual([]);
    expect(page.matched).toBe(0);
    expect(page.hasMore).toBe(false);
  });
});

// ── status / kind ─────────────────────────────────────────────────────────

describe('status and kind filters', () => {
  it('filters by exact status', async () => {
    seed([{ id: 1, status: 'todo' }, { id: 2, status: 'in_progress' }, { id: 3, status: 'in_progress' }]);
    const page = asPage(await service().listTicketPageForChat(1, 165, 'user-1', { status: 'in_progress' }));
    expect(page.tickets.map((t) => t.ref)).toEqual(['2', '3']);
    expect(page.total).toBe(3);
  });

  it('status is case-insensitive', async () => {
    seed([{ id: 1, status: 'In_Progress' }, { id: 2, status: 'todo' }]);
    const page = asPage(await service().listTicketPageForChat(1, 165, 'user-1', { status: 'IN_PROGRESS' }));
    expect(page.tickets.map((t) => t.ref)).toEqual(['1']);
  });

  it('filters by kind', async () => {
    seed([
      { id: 1, status: 'todo', taskType: 'task' },
      { id: 2, status: 'todo', taskType: 'epic' },
      { id: 3, status: 'todo', taskType: 'gap' },
    ]);
    const page = asPage(await service().listTicketPageForChat(1, 165, 'user-1', { kind: 'epic' }));
    expect(page.tickets.map((t) => t.ref)).toEqual(['2']);
  });

  it('composes status AND kind AND openOnly together', async () => {
    seed([
      { id: 1, status: 'todo', taskType: 'task' },
      { id: 2, status: 'todo', taskType: 'epic' },
      { id: 3, status: 'in_progress', taskType: 'task' },
      { id: 4, status: 'done', taskType: 'task' },
    ]);
    const page = asPage(await service().listTicketPageForChat(1, 165, 'user-1', {
      status: 'in_progress',
      kind: 'task',
      openOnly: true,
    }));
    expect(page.tickets.map((t) => t.ref)).toEqual(['3']);
    expect(page.matched).toBe(1);
    expect(page.total).toBe(4);
  });
});

// ── paging ────────────────────────────────────────────────────────────────

describe('limit and offset', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, status: i % 5 === 0 ? 'done' : 'todo' }));

  it('caps the page and flags that more remain', async () => {
    seed(many);
    const page = asPage(await service().listTicketPageForChat(1, 165, 'user-1', { openOnly: true, limit: 5 }));
    expect(page.tickets).toHaveLength(5);
    expect(page.hasMore).toBe(true);
    // The point of hasMore: a truncated page is self-describing, so a caller
    // never reads a full list off a partial answer.
    expect(page.matched).toBe(20);
    expect(page.total).toBe(25);
  });

  it('pages through the whole filtered set with offset without overlap', async () => {
    // Re-seed before EACH call: the fake DB hands back its queue in order, so a
    // second invocation needs a fresh chat + links + batch triple.
    seed(many);
    const first = asPage(await service().listTicketPageForChat(1, 165, 'user-1', { openOnly: true, limit: 5, offset: 0 }));
    seed(many);
    const second = asPage(await service().listTicketPageForChat(1, 165, 'user-1', { openOnly: true, limit: 5, offset: 5 }));
    const firstRefs = first.tickets.map((t) => t.ref);
    const secondRefs = second.tickets.map((t) => t.ref);
    // `many` marks ids 1, 6, 11, 16, 21 done, so the open set is everything
    // else — offset slices the FILTERED list, not the raw 25.
    expect(firstRefs).toEqual(['2', '3', '4', '5', '7']);
    expect(secondRefs).toEqual(['8', '9', '10', '12', '13']);
    // No overlap between consecutive pages.
    expect(firstRefs.filter((r) => secondRefs.includes(r))).toEqual([]);
  });

  it('reports hasMore false on the final page', async () => {
    seed([{ id: 1, status: 'todo' }, { id: 2, status: 'todo' }]);
    const page = asPage(await service().listTicketPageForChat(1, 165, 'user-1', { openOnly: true, limit: 10 }));
    expect(page.hasMore).toBe(false);
  });

  it('clamps limit into range instead of trusting it', async () => {
    seed(many);
    // A limit of 0 would otherwise return nothing, and an unbounded limit would
    // defeat the point of paging.
    const zero = asPage(await service().listTicketPageForChat(1, 165, 'user-1', { openOnly: true, limit: 0 }));
    expect(zero.tickets.length).toBe(1);

    seed(many);
    const huge = asPage(await service().listTicketPageForChat(1, 165, 'user-1', { openOnly: true, limit: 999_999 }));
    expect(huge.tickets).toHaveLength(20);
    expect(huge.hasMore).toBe(false);
  });

  it('treats a negative offset as zero rather than slicing from the end', async () => {
    seed(many);
    const page = asPage(await service().listTicketPageForChat(1, 165, 'user-1', { openOnly: true, offset: -5 }));
    expect(page.tickets[0]?.ref).toBe('2');
  });
});

// ── the batch promise still holds ─────────────────────────────────────────

describe('ticketHealthBatch is still called once', () => {
  it('issues ONE health batch for the whole chat, filters included', async () => {
    // Filtering happens AFTER the batch, so a chat with 50 links and three
    // filters is still a constant number of queries — not a query per filter
    // and not a query per link.
    const many = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, status: i % 3 === 0 ? 'done' : 'todo' }));
    seed(many);
    await service().listTicketPageForChat(1, 165, 'user-1', { openOnly: true, kind: 'task', limit: 5 });
    // 1 = ownedChat, 1 = the links query, 1 = the task-tier batch. Filtering
    // added no queries.
    expect(selectCount).toBe(3);
  });
});

// ── the page method always answers with the envelope ──────────────────────

describe('listTicketPageForChat always returns the envelope', () => {
  it('wraps every link even with no options', async () => {
    seed([{ id: 1, status: 'todo' }, { id: 2, status: 'done' }]);
    const page = asPage(await service().listTicketPageForChat(1, 165, 'user-1'));
    expect(page).toMatchObject({ total: 2, matched: 2, hasMore: false });
    expect(page.tickets).toHaveLength(2);
  });

  it('wraps an empty chat too', async () => {
    queue = [[{ id: 165, tenantId: 1 }], []];
    expect(asPage(await service().listTicketPageForChat(1, 165, 'user-1'))).toEqual({ tickets: [], total: 0, matched: 0, hasMore: false });
  });

  it('passes a not-found chat through as the error', async () => {
    queue = [[]];
    expect(await service().listTicketPageForChat(1, 165, 'user-1', { openOnly: true })).toEqual({ error: 'Chat not found' });
  });
});

describe('pageChatTickets guards non-finite paging', () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({ ref: String(i + 1) })) as unknown as ChatTicketLink[];

  it('treats a NaN / Infinity limit as "all" and a NaN offset as 0', () => {
    expect(pageChatTickets(rows, 3, { limit: Number.NaN }).tickets).toHaveLength(3);
    expect(pageChatTickets(rows, 3, { limit: Number.POSITIVE_INFINITY }).tickets).toHaveLength(3);
    expect(pageChatTickets(rows, 3, { offset: Number.NaN, limit: 2 })).toMatchObject({ matched: 3, hasMore: true });
    expect(pageChatTickets(rows, 3, { offset: Number.NaN, limit: 2 }).tickets.map((t) => t.ref)).toEqual(['1', '2']);
  });
});
