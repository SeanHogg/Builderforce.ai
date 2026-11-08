import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { BOOKKEEPING_ACTION_TYPES, CONDUCT_MARKER_ACTION, retainsDetail } from './managerActionJournal';
import { listManagerActions } from './ManagerService';
import { stampConducted } from '../repos/conductMarker';

const source = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url).href), 'utf8');

describe('bookkeeping action types', () => {
  it('declares the conduct marker once, in the journal', () => {
    expect(CONDUCT_MARKER_ACTION).toBe('conduct_seen');
    expect(CONDUCT_MARKER_ACTION.length).toBeLessThanOrEqual(24);
    expect(BOOKKEEPING_ACTION_TYPES).toContain(CONDUCT_MARKER_ACTION);
    expect(source('../repos/conductMarker.ts')).not.toMatch(/'conduct_seen'/);
  });

  it('the activity feed query excludes them IN SQL (so the limit stays correct)', async () => {
    let whereArg: unknown;
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'from', 'leftJoin', 'orderBy']) chain[m] = vi.fn(() => chain);
    chain.where = vi.fn((w: unknown) => { whereArg = w; return chain; });
    chain.limit = vi.fn(async () => []);
    await listManagerActions(chain as never, 1, 2, 30);
    const q = new PgDialect().sqlToQuery(whereArg as never);
    expect(q.sql).toMatch(/"action_type" not in/);
    expect(q.params).toContain(CONDUCT_MARKER_ACTION);
  });

  it('the digest and the wiring audit exclude them in their queries', () => {
    for (const f of ['./dailyDigest.ts', '../activity/autonomyWiringAudit.ts']) {
      expect(source(f)).toMatch(/notInArray\(managerActions\.actionType, \[\.\.\.BOOKKEEPING_ACTION_TYPES\]\)/);
    }
  });
});

describe('conduct marker retention', () => {
  it('carries no detail payload (not retained as a cron feed row)', () => {
    expect(retainsDetail({ tenantId: 1, projectId: 1, actionType: CONDUCT_MARKER_ACTION, summary: 's' }, false)).toBe(false);
  });

  it('is refreshed IN PLACE (one row per ticket, never one per interval)', async () => {
    const set = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const db = { update: vi.fn(() => ({ set })), insert: vi.fn() } as never;
    const NOW = Date.now();
    const markers = new Map([[5, new Date(NOW - 11 * 60_000)]]);
    expect(await stampConducted(db, { tenantId: 1, projectId: 2, taskId: 5, title: 't', now: NOW }, markers)).toBe(true);
    expect(set).toHaveBeenCalledTimes(1);
    expect((db as unknown as { insert: ReturnType<typeof vi.fn> }).insert).not.toHaveBeenCalled();
    expect(markers.get(5)!.getTime()).toBe(NOW);
  });

  it('ages out with the table\'s registry retention (30d), far past the 30-minute trust window', () => {
    expect(source('../maintenance/sweptTables.ts')).toMatch(/relation: 'manager_actions',[\s\S]*?retentionDays: 30/);
  });
});
