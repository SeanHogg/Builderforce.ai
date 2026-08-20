import { describe, expect, it } from 'vitest';
import { loadTeamRoster, seatRoster } from './TeamRoster';
import type { Db } from '../../infrastructure/database/connection';

/**
 * PRD 21 §4.1 — one roster read model. What is worth locking is not the SQL but
 * the three promises the model makes to the footer, the presence pile and the
 * drop target:
 *
 *  1. humans and agents come back in ONE row shape with a `kind` discriminator;
 *  2. a seat with nothing provisioned behind it is `locked`, never omitted
 *     (§2.6 rule 7 — disable, never hide);
 *  3. a domain owned by `Platform` has no teammate, so it never appears.
 *
 * A fourth promise since the marketplace learned to charge: an agent this
 * workspace HIRED is on the roster too. Its `ide_agents` row belongs to the
 * seller, so the hire ids have to be read first — which is why the fake answers
 * four statements now, not three.
 */

/** The hire read runs first; the other three then run in `Promise.all`, so the
 *  fake answers them in array order. */
function fakeDb(agentRows: unknown[], humanRows: unknown[], hireRows: unknown[], hiredAgentIds: unknown[] = []): Db {
  const queue = [hiredAgentIds, agentRows, humanRows, hireRows];
  const chain = (rows: unknown[]) => {
    const node: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'where']) {
      node[method] = () => (method === 'where' ? Promise.resolve(rows) : node);
    }
    return node;
  };
  return { select: () => chain(queue.shift() ?? []) } as unknown as Db;
}

const NOW = Date.parse('2026-08-08T12:00:00Z');

describe('team roster', () => {
  it('lists only seats that have an owner who is a teammate', () => {
    const seats = seatRoster().map((s) => s.seat);
    // Every Platform-owned domain is a panel only — there is no one to drag in.
    expect(seats).not.toContain('Platform');
    // The board is the canvas itself rather than a chip beside it.
    expect(seats).not.toContain('Brain');
    expect(seats).toEqual(expect.arrayContaining(['CMO', 'Manager', 'CFO', 'CRO', 'HR', 'Security', 'CEO', 'Support', 'Recruiter']));
  });

  it('returns humans and agents in one row shape, seats first', async () => {
    const db = fakeDb(
      [
        { id: 'manager-t1', name: 'Ada', title: 'AI Manager', builtinKind: 'manager', lastUsedAt: new Date(NOW - 60_000) },
        { id: 'agent-x', name: 'Zed', title: null, builtinKind: null, lastUsedAt: null },
      ],
      [{ id: 'u1', displayName: 'Sean', username: null, email: 's@x.io', avatarUrl: null, role: 'owner' }],
      [],
    );

    const roster = await loadTeamRoster(db, 1, NOW);
    const manager = roster.find((m) => m.seat === 'Manager');

    // The seat is backed by the real agent row, and recent use reads as busy.
    expect(manager).toMatchObject({ kind: 'agent', id: 'manager-t1', name: 'Ada', availability: 'busy', alwaysOn: true, locked: false });
    // A seat with no provisioned agent is still listed — visible and disabled.
    expect(roster.find((m) => m.seat === 'CFO')).toMatchObject({ locked: true, availability: 'unprovisioned', alwaysOn: true });
    // One shape: the human differs from the agent only by `kind`.
    expect(roster.find((m) => m.kind === 'human')).toMatchObject({ id: 'u1', name: 'Sean', role: 'owner', alwaysOn: false });
    // An agent claimed by a seat is not listed twice.
    expect(roster.filter((m) => m.id === 'manager-t1')).toHaveLength(1);
    expect(roster.find((m) => m.id === 'agent-x')).toMatchObject({ kind: 'agent', alwaysOn: false, availability: 'available' });
    // Seats lead; the invited team follows.
    expect(roster.findIndex((m) => m.kind === 'human')).toBeGreaterThan(roster.findIndex((m) => m.alwaysOn));
  });

  it('lists an agent this workspace HIRED, whose ide_agents row belongs to the seller', async () => {
    const db = fakeDb(
      // The agent read now returns the hired row too, because the predicate it
      // runs is "owned OR hired" rather than "tenant_id = mine".
      [{ id: 'bought-1', name: 'Release Captain', title: null, builtinKind: null, lastUsedAt: null }],
      [],
      [],
      [{ agentId: 'bought-1' }],
    );
    const roster = await loadTeamRoster(db, 1, NOW);
    expect(roster.find((m) => m.id === 'bought-1')).toMatchObject({
      kind: 'agent', name: 'Release Captain', alwaysOn: false, locked: false,
    });
  });

  it('keeps a live engagement out of the roster twice over', async () => {
    const db = fakeDb(
      [],
      [{ id: 'u1', displayName: 'Sean', username: null, email: null, avatarUrl: null, role: 'owner' }],
      [{ id: 'u1', displayName: 'Sean', username: null, email: null, avatarUrl: null }],
    );
    const roster = await loadTeamRoster(db, 1, NOW);
    expect(roster.filter((m) => m.id === 'u1')).toHaveLength(1);
  });
});
