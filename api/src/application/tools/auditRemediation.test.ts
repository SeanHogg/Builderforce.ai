import { describe, expect, it, vi } from 'vitest';
import { ensureRemediationTickets, findingFingerprint } from './auditRemediation';

const finding = { title: 'Missing tenant filter', location: 'src/users.ts:12:3', severity: 'high' as const, recommendation: 'Scope the query.' };
const args = { tenantId: 7, projectId: 42, auditId: 'quality-audit', auditName: 'Quality Audit', runId: 'r1', findings: [finding] };

function fakeDb(selects: unknown[][], claim = true) {
  const updates: unknown[] = [];
  return {
    updates,
    insert: vi.fn(() => ({ values: () => ({ onConflictDoNothing: async () => undefined }) })),
    select: vi.fn(() => ({ from: () => ({ where: () => {
      const rows = selects.shift() ?? [];
      return Object.assign(Promise.resolve(rows), { limit: async () => rows });
    } }) })),
    update: vi.fn(() => ({ set: (value: unknown) => {
      updates.push(value);
      return { where: () => Object.assign(Promise.resolve(), { returning: async () => claim ? [{ id: 'claim' }] : [] }) };
    } })),
  };
}

describe('audit remediation identities', () => {
  it('ignores line shifts, severity and recommendation changes, but separates audits and files', async () => {
    const fingerprint = await findingFingerprint(args.auditId, finding);
    expect(await findingFingerprint(args.auditId, { ...finding, location: 'src/users.ts:90', severity: 'low', recommendation: 'Updated fix' })).toBe(fingerprint);
    expect(await findingFingerprint('soc2-audit', finding)).not.toBe(fingerprint);
    expect(await findingFingerprint(args.auditId, { ...finding, location: 'src/admin.ts' })).not.toBe(fingerprint);
  });
  it('links an existing ticket without creating another', async () => {
    const db = fakeDb([[{ taskId: 123 }], [{ id: 123, status: 'todo', archived: false }]]);
    const service = { createTask: vi.fn() };
    expect(await ensureRemediationTickets(db as never, service as never, args)).toEqual([123]);
    expect(service.createTask).not.toHaveBeenCalled();
  });
  it('creates independently remediable tickets and persists their identity', async () => {
    const db = fakeDb([[{ taskId: null }], []]);
    const service = { createTask: vi.fn(async (_input: unknown) => ({ id: 321 })) };
    expect(await ensureRemediationTickets(db as never, service as never, args)).toEqual([321]);
    expect(service.createTask.mock.calls[0]?.[0]).toMatchObject({ projectId: 42, title: 'Quality Audit: Missing tenant filter' });
    expect(db.updates).toContainEqual({ taskId: 321, leaseUntil: null });
  });
  it('recovers a task written before a crash without duplicating it', async () => {
    const marker = `[audit-finding:${await findingFingerprint(args.auditId, finding)}]`;
    const db = fakeDb([[{ taskId: null }], [{ id: 44, description: marker }]]);
    const service = { createTask: vi.fn() };
    expect(await ensureRemediationTickets(db as never, service as never, args)).toEqual([44]);
    expect(service.createTask).not.toHaveBeenCalled();
  });
  it('refuses simultaneous owners and releases its lease after a failure', async () => {
    const service = { createTask: vi.fn(async () => { throw new Error('Board unavailable'); }) };
    await expect(ensureRemediationTickets(fakeDb([[{ taskId: null }]], false) as never, service as never, args)).rejects.toThrow('another report');
    const db = fakeDb([[{ taskId: null }], []]);
    await expect(ensureRemediationTickets(db as never, service as never, args)).rejects.toThrow('Board unavailable');
    expect(db.updates).toContainEqual({ leaseUntil: null });
  });
  it('records no remediation for a clean pass or informational observations', async () => {
    const db = fakeDb([]);
    expect(await ensureRemediationTickets(db as never, {} as never, { ...args, findings: [{ ...finding, severity: 'info' }] })).toEqual([]);
    expect(db.insert).not.toHaveBeenCalled();
  });
  it('creates active remediation when a previously closed finding recurs', async () => {
    const db = fakeDb([[{ taskId: 123 }], [{ id: 123, status: 'done', archived: false }], []]);
    const service = { createTask: vi.fn(async () => ({ id: 456 })) };
    expect(await ensureRemediationTickets(db as never, service as never, args)).toEqual([456]);
    expect(db.updates).toContainEqual({ taskId: null });
  });
});
