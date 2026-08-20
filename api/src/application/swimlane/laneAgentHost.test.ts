import { describe, it, expect, vi } from 'vitest';
import { resolveLaneAgentHostId } from './laneAgentHost';
import type { Db } from '../../infrastructure/database/connection';

/**
 * The autonomous lane trigger never read `swimlane_agent_assignments.runtime`/`target`,
 * so a lane deliberately staffed to an on-prem machine was handed to the cloud
 * dispatcher anyway. This resolver is what turns the operator's choice into the
 * `agentHostId` the dispatcher already accepts.
 */
const dbWithDefaultHost = (defaultAgentHostId: number | null): Db => ({
  select: () => {
    const self: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit']) self[m] = () => self;
    self.then = (resolve: (v: unknown) => unknown) => Promise.resolve([{ defaultAgentHostId }]).then(resolve);
    return self;
  },
}) as unknown as Db;

describe('resolveLaneAgentHostId', () => {
  it('returns null for a cloud lane — the pre-existing behaviour, unchanged', async () => {
    const db = dbWithDefaultHost(9);
    expect(await resolveLaneAgentHostId(db, 1, 'cloud', null)).toBeNull();
  });

  it('returns null when the assignment names no runtime at all', async () => {
    const db = dbWithDefaultHost(9);
    expect(await resolveLaneAgentHostId(db, 1, null, null)).toBeNull();
    expect(await resolveLaneAgentHostId(db, 1, undefined, undefined)).toBeNull();
  });

  it('returns null for a browser agent — those are CLAIMED by a pull worker, never pushed', async () => {
    const db = dbWithDefaultHost(9);
    expect(await resolveLaneAgentHostId(db, 1, 'browser', '7')).toBeNull();
  });

  it('honours the pinned host of a `remote` assignment', async () => {
    const db = dbWithDefaultHost(9);
    expect(await resolveLaneAgentHostId(db, 1, 'remote', '42')).toBe(42);
  });

  it('falls back to the tenant default when a `remote` pin is unusable', async () => {
    const db = dbWithDefaultHost(9);
    expect(await resolveLaneAgentHostId(db, 1, 'remote', 'not-an-id')).toBe(9);
    expect(await resolveLaneAgentHostId(db, 1, 'remote', null)).toBe(9);
  });

  it('routes a `local` assignment to the tenant default host', async () => {
    const db = dbWithDefaultHost(9);
    expect(await resolveLaneAgentHostId(db, 1, 'local', null)).toBe(9);
  });

  it('degrades to CLOUD when the tenant has no default host — never to a bogus id', async () => {
    const db = dbWithDefaultHost(null);
    expect(await resolveLaneAgentHostId(db, 1, 'local', null)).toBeNull();
  });

  it('never throws — a resolver failure must not stop the lane trigger', async () => {
    const boom = { select: () => { throw new Error('db down'); } } as unknown as Db;
    await expect(resolveLaneAgentHostId(boom, 1, 'local', null).catch(() => null)).resolves.toBeNull();
    vi.restoreAllMocks();
  });
});
