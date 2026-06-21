import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QaFlowService } from './QaFlowService';

/**
 * Fake Db that mimics the drizzle chain QaFlowService.aggregate uses:
 *   select(cols).from(t).where(cond).orderBy(...).limit(n)  -> Promise<rows>
 *   insert(t).values(v).onConflictDoUpdate(...)             -> Promise
 *
 * The aggregator always reads journey events in keyset (sessionId, seq) order
 * moving forward, so we serve from a globally sorted queue and pop `limit` rows
 * per page — this reproduces the real cursor walk without re-implementing the
 * drizzle operator objects. We detect the "is there more?" existence probe by
 * its projection shape ({ one }) and the upsert by the insert path.
 */
interface Ev { sessionId: string; seq: number; type: string; route: string | null; selector: string | null; label: string | null; value: string | null }

function makeEvent(sessionId: string, seq: number, route: string): Ev {
  return { sessionId, seq, type: 'pageview', route, selector: null, label: null, value: null };
}

function fakeDb(allEvents: Ev[]) {
  // Stable keyset sort, mirroring orderBy(asc(sessionId), asc(seq)).
  const sorted = [...allEvents].sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : a.seq - b.seq));
  let cursor = 0; // how many event rows have been consumed by paged reads
  const upserts: unknown[] = [];

  const db = {
    upserts,
    select(cols?: Record<string, unknown>) {
      const isExistenceProbe = cols != null && 'one' in cols;
      let limit = Infinity;
      const chain = {
        from() { return chain; },
        where() { return chain; },
        orderBy() { return chain; },
        limit(n: number) { limit = n; return chain; },
        then(resolve: (rows: unknown[]) => unknown) {
          if (isExistenceProbe) {
            // Is there at least one event past the current cursor?
            return resolve(cursor < sorted.length ? [{ one: 1 }] : []);
          }
          const page = sorted.slice(cursor, cursor + limit);
          cursor += page.length;
          return resolve(page);
        },
      };
      return chain;
    },
    insert() {
      const chain = {
        values(v: unknown) { upserts.push(v); return chain; },
        onConflictDoUpdate() { return Promise.resolve(); },
      };
      return chain;
    },
  };
  return db;
}

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('QaFlowService.aggregate — paginated read [#156]', () => {
  it('pages through all events within the ceiling and reports no truncation', async () => {
    // 3 sessions, each a 2-route flow → 6 events, all under the ceiling.
    const events: Ev[] = [];
    for (const s of ['a', 'b', 'c']) {
      events.push(makeEvent(s, 0, '/dashboard'));
      events.push(makeEvent(s, 1, '/projects'));
    }
    const db = fakeDb(events);
    const res = await new QaFlowService(db as never).aggregate(1, undefined, { pageSize: 2 });

    expect(res.eventsScanned).toBe(6);
    expect(res.truncated).toBe(false);
    // All three sessions share one route signature → collapses to one flow.
    expect(res.upserted).toBe(1);
  });

  it('flags truncation and logs when the event ceiling is hit', async () => {
    const events: Ev[] = [];
    for (let i = 0; i < 10; i++) {
      events.push(makeEvent(`s${String(i).padStart(2, '0')}`, 0, '/dashboard'));
      events.push(makeEvent(`s${String(i).padStart(2, '0')}`, 1, '/projects'));
    }
    const db = fakeDb(events); // 20 events total
    const res = await new QaFlowService(db as never).aggregate(1, undefined, { maxEvents: 4, pageSize: 2 });

    expect(res.eventsScanned).toBe(4);
    expect(res.truncated).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('event ceiling'));
  });

  it('keyset cursor keeps a session contiguous across page boundaries', async () => {
    // One session spanning 4 events read at pageSize 1 must still aggregate as
    // a single 2-route flow (not split by paging).
    const events = [
      makeEvent('only', 0, '/dashboard'),
      makeEvent('only', 1, '/dashboard'),
      makeEvent('only', 2, '/projects'),
      makeEvent('only', 3, '/projects'),
    ];
    const db = fakeDb(events);
    const res = await new QaFlowService(db as never).aggregate(1, undefined, { pageSize: 1 });
    expect(res.eventsScanned).toBe(4);
    expect(res.upserted).toBe(1);
  });
});
