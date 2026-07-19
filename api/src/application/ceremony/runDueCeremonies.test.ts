import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Stub the infrastructure the sweep reaches for ───────────────────────────────
// The sweep's logic under test is due-detection + roster assembly + the
// unconditional re-arm; the DB driver, metrics reader and runtime dispatcher are
// all boundaries, so they're stubbed and their calls asserted.

const state = {
  /** FIFO of results handed to each awaited query builder, in call order. */
  results: [] as unknown[][],
  /** Every update() the sweep issued: { table, patch }. */
  updates: [] as Array<{ patch: Record<string, unknown> }>,
  /** Every insert() the sweep issued: { table, values }. */
  inserts: [] as Array<{ values: unknown }>,
  /** The `where` predicate objects passed to the top-level due query. */
  selectCount: 0,
};

function nextResult(): unknown[] {
  return state.results.shift() ?? [];
}

/**
 * A chainable, thenable query-builder stub. Every terminal method returns `this`,
 * and awaiting it pops the next queued result — enough to drive drizzle-shaped
 * `select().from().where().orderBy().limit()` and `insert().values().returning()`.
 */
function builder(onResolve?: () => unknown[]) {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'limit', 'set', 'values', 'returning']) {
    b[m] = () => b;
  }
  b.then = (res: (v: unknown[]) => unknown) => res(onResolve ? onResolve() : nextResult());
  return b;
}

const fakeDb = {
  select: () => { state.selectCount += 1; return builder(); },
  insert: () => {
    const b = builder();
    const origValues = b.values as () => unknown;
    b.values = (v: unknown) => { state.inserts.push({ values: v }); return origValues(); };
    return b;
  },
  update: () => {
    const b = builder(() => []);
    b.set = (patch: Record<string, unknown>) => { state.updates.push({ patch }); return b; };
    return b;
  },
};

vi.mock('../../infrastructure/database/connection', () => ({
  buildDatabase: () => fakeDb,
}));

vi.mock('../metrics/workforceMetrics', () => ({
  computeMemberMetrics: async () => [
    { memberKind: 'human', memberRef: 'u1', memberName: 'Ada', engagementScore: 90 },
    { memberKind: 'human', memberRef: 'u2', memberName: 'Grace', engagementScore: 10 },
  ],
  memberMetricsCacheKey: (t: number, v: number, d: number) => `mm:${t}:${v}:${d}`,
  readWorkforceMetricsVersion: async () => 1,
}));

vi.mock('../swimlane/laneEntryTrigger', () => ({ maybeAutoRunOnLaneEntry: async () => true }));
vi.mock('../../buildRuntimeService', () => ({ buildRuntimeService: () => ({}) }));

import {
  runDueCeremonies,
  computeNextCeremonyRun,
  buildRoster,
  parseParticipants,
} from './runDueCeremonies';

const schedule = (over: Record<string, unknown> = {}) => ({
  id: 's1', tenantId: 1, segmentId: 'seg', projectId: 7,
  kind: 'standup', cron: '0 9 * * 1-5', timezone: 'UTC', enabled: true,
  turnMode: null, turnSeconds: null,
  participantScope: 'members', participants: '[]', maxParticipants: 25,
  autoDispatch: false, nextRunAt: new Date('2026-07-01T09:00:00Z'),
  lastRunAt: null, lastStatus: null, lastSessionId: null, createdBy: null,
  createdAt: new Date(), updatedAt: new Date(),
  ...over,
});

beforeEach(() => {
  state.results = [];
  state.updates = [];
  state.inserts = [];
  state.selectCount = 0;
});

// ── Re-arm ─────────────────────────────────────────────────────────────────────

describe('computeNextCeremonyRun', () => {
  it('advances to the next cron instant in the schedule timezone', () => {
    // 09:00 Mon-Fri UTC; from Wed 10:00 the next instant is Thu 09:00.
    const next = computeNextCeremonyRun('0 9 * * 1-5', 'UTC', new Date('2026-07-01T10:00:00Z'));
    expect(next.toISOString()).toBe('2026-07-02T09:00:00.000Z');
  });

  it('respects a non-UTC timezone', () => {
    // 09:00 New York on 2026-07-01 (EDT, UTC-4) = 13:00Z.
    const next = computeNextCeremonyRun('0 9 * * *', 'America/New_York', new Date('2026-07-01T00:00:00Z'));
    expect(next.toISOString()).toBe('2026-07-01T13:00:00.000Z');
  });

  it('is always strictly in the future, so a due row cannot re-fire on the next tick', () => {
    const now = new Date('2026-07-01T09:00:00Z');
    expect(computeNextCeremonyRun('0 9 * * 1-5', 'UTC', now).getTime()).toBeGreaterThan(now.getTime());
  });

  it('falls back to +24h for a malformed cron instead of wedging the row', () => {
    const now = new Date('2026-07-01T09:00:00Z');
    expect(computeNextCeremonyRun('not a cron', 'UTC', now).toISOString()).toBe('2026-07-02T09:00:00.000Z');
    // Unsatisfiable (Feb 31) also falls back rather than returning null.
    expect(computeNextCeremonyRun('0 9 31 2 *', 'UTC', now).toISOString()).toBe('2026-07-02T09:00:00.000Z');
  });
});

// ── Roster assembly ────────────────────────────────────────────────────────────

describe('parseParticipants', () => {
  it('parses a JSON roster array', () => {
    expect(parseParticipants('[{"kind":"human","ref":"u1","name":"Ada"}]'))
      .toEqual([{ kind: 'human', ref: 'u1', name: 'Ada' }]);
  });
  it('returns [] for null, empty, malformed, or non-array input', () => {
    expect(parseParticipants(null)).toEqual([]);
    expect(parseParticipants('')).toEqual([]);
    expect(parseParticipants('{not json')).toEqual([]);
    expect(parseParticipants('{"kind":"human"}')).toEqual([]);
  });
  it('drops entries with no ref', () => {
    expect(parseParticipants('[{"kind":"human","name":"Ada"},{"kind":"human","ref":"u2","name":"G"}]'))
      .toEqual([{ kind: 'human', ref: 'u2', name: 'G' }]);
  });
});

describe('buildRoster', () => {
  const cards = [
    { memberKind: 'human', memberRef: 'u1', memberName: 'Ada', engagementScore: 90 },
    { memberKind: 'human', memberRef: 'u2', memberName: 'Grace', engagementScore: 10 },
    { memberKind: 'cloud_agent', memberRef: 'a1', memberName: 'Bot', engagementScore: null },
  ] as never;

  it('orders a derived roster quietest-first, nulls last', () => {
    expect(buildRoster('members', [], cards, 25).map((p) => p.ref)).toEqual(['u2', 'u1', 'a1']);
  });

  it('caps a derived roster at maxParticipants', () => {
    expect(buildRoster('members', [], cards, 2).map((p) => p.ref)).toEqual(['u2', 'u1']);
  });

  it('uses the explicit list (not metrics) for the roster scope', () => {
    const explicit = [{ kind: 'human', ref: 'x9', name: 'Pat' }];
    expect(buildRoster('roster', explicit, cards, 25)).toEqual(explicit);
  });

  it('drops ref-less explicit entries and caps them too', () => {
    const explicit = [
      { kind: 'human', ref: '', name: 'Nobody' },
      { kind: 'human', ref: 'x1', name: 'A' },
      { kind: 'human', ref: 'x2', name: 'B' },
    ];
    expect(buildRoster('roster', explicit, cards, 1).map((p) => p.ref)).toEqual(['x1']);
  });
});

// ── Due detection + watermark ──────────────────────────────────────────────────

describe('runDueCeremonies', () => {
  it('opens a session and seeds the roster for a due schedule', async () => {
    state.results = [
      [schedule()],  // due query
      [],            // no already-active session
      [],            // no board row -> defaults
      [{ id: 'sess-1' }], // session insert returning
    ];
    const r = await runDueCeremonies({} as never);

    expect(r.due).toBe(1);
    expect(r.opened).toBe(1);
    expect(r.errors).toBe(0);

    // Participants seeded from the (mocked) member metrics, quietest first.
    const participantInsert = state.inserts.at(-1)?.values as Array<Record<string, unknown>>;
    expect(participantInsert.map((p) => p.memberRef)).toEqual(['u2', 'u1']);
    expect(participantInsert.map((p) => p.turnOrder)).toEqual([0, 1]);

    // The session is linked back to its schedule.
    const sessionInsert = state.inserts[0]?.values as Record<string, unknown>;
    expect(sessionInsert.scheduleId).toBe('s1');
    expect(sessionInsert.status).toBe('active');
  });

  it('re-arms next_run_at and stamps the watermark after opening', async () => {
    state.results = [[schedule()], [], [], [{ id: 'sess-1' }]];
    await runDueCeremonies({} as never);

    expect(state.updates).toHaveLength(1);
    const patch = state.updates[0]!.patch;
    expect(patch.lastStatus).toBe('opened');
    expect(patch.lastSessionId).toBe('sess-1');
    expect(patch.lastRunAt).toBeInstanceOf(Date);
    // Re-armed strictly into the future, so it cannot re-fire next tick.
    expect((patch.nextRunAt as Date).getTime()).toBeGreaterThan((patch.lastRunAt as Date).getTime());
  });

  it('skips (without opening) when a session is already active, but STILL re-arms', async () => {
    state.results = [[schedule()], [{ id: 'live' }]];
    const r = await runDueCeremonies({} as never);

    expect(r.opened).toBe(0);
    expect(r.skipped).toBe(1);
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]!.patch.lastStatus).toBe('already_active');
    expect(state.updates[0]!.patch.nextRunAt).toBeInstanceOf(Date);
    // No session opened -> the last-session pointer is left untouched.
    expect(state.updates[0]!.patch.lastSessionId).toBeUndefined();
  });

  it('skips a roster-scoped schedule with an empty roster, and still paces it out', async () => {
    state.results = [[schedule({ participantScope: 'roster', participants: '[]' })], []];
    const r = await runDueCeremonies({} as never);

    expect(r.opened).toBe(0);
    expect(r.skipped).toBe(1);
    expect(state.updates[0]!.patch.lastStatus).toBe('no_participants');
    expect(state.updates[0]!.patch.nextRunAt).toBeInstanceOf(Date);
  });

  it('advances the watermark even when the row throws, so a bad schedule paces out', async () => {
    // Only the due query resolves; the session-insert path gets no queued result
    // for `.returning()`, producing an insert_failed rather than a thrown sweep.
    state.results = [[schedule()], [], [], []];
    const r = await runDueCeremonies({} as never);

    expect(r.opened).toBe(0);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]!.patch.nextRunAt).toBeInstanceOf(Date);
  });

  it('is a no-op on an idle tick (one query, no writes)', async () => {
    state.results = [[]];
    const r = await runDueCeremonies({} as never);

    expect(r).toEqual({ due: 0, opened: 0, skipped: 0, errors: 0 });
    expect(state.selectCount).toBe(1);
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it('processes each due schedule independently', async () => {
    state.results = [
      [schedule({ id: 's1' }), schedule({ id: 's2', kind: 'planning' })],
      [{ id: 'live' }],                 // s1 already active -> skipped
      [], [], [{ id: 'sess-2' }],       // s2 opens
    ];
    const r = await runDueCeremonies({} as never);

    expect(r.due).toBe(2);
    expect(r.opened).toBe(1);
    expect(r.skipped).toBe(1);
    // BOTH rows re-armed, regardless of outcome.
    expect(state.updates).toHaveLength(2);
  });
});
