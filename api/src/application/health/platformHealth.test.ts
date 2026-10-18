import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

import { databaseSection, inspectDatabase, runtimeSection, workerSection } from './platformHealth';

const asDb = (db: unknown) => db as Db;
const rows = (r: unknown[]) => ({ rows: r }) as unknown as unknown[];

/** Sections of THE health use case are independent and failure-contained. */
describe('platformHealth sections', () => {
  it('database: a successful ping is ok, a failing one is degraded (not thrown)', async () => {
    expect((await databaseSection(asDb(fakeDb([rows([{ '?column?': 1 }])])))).ok).toBe(true);
    expect(await databaseSection(asDb(fakeDb([new Error('down')])))).toEqual({ ok: false, latencyMs: 0 });
  });

  it('runtime: counts are numbers, and an unreadable runtime reads as zeroes', async () => {
    const ok = await runtimeSection(asDb(fakeDb([rows([{ agentHosts: 3, onlineAgentHosts: 1, activeExecutions: 2, failedExecutions24h: 0 }])])));
    expect(ok).toEqual({ agentHosts: 3, onlineAgentHosts: 1, activeExecutions: 2, failedExecutions24h: 0 });
    const down = await runtimeSection(asDb(fakeDb([new Error('down')])));
    expect(down).toEqual({ agentHosts: 0, onlineAgentHosts: 0, activeExecutions: 0, failedExecutions24h: 0 });
  });

  it('databases: inspection failure is reported on the entry, not raised', async () => {
    const out = await inspectDatabase(asDb(fakeDb([new Error('nope')])), 'primary', {} as Env);
    expect(out.ok).toBe(false);
    expect(out.name).toBe('primary');
    expect(out.tables).toEqual([]);
  });

  it('worker: reports bindings as booleans without touching I/O', () => {
    const w = workerSection({ ENVIRONMENT: 'test' } as unknown as Env);
    expect(w.environment).toBe('test');
    expect(Object.values(w.bindings).every((v) => typeof v === 'boolean')).toBe(true);
  });
});
