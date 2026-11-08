import { describe, expect, it } from 'vitest';
import { insertToolAudit } from './toolAuditWrite';
import type { Db } from '../../infrastructure/database/connection';

function fakeDb() {
  const seen: unknown[] = [];
  const db = { insert: () => ({ values: (v: unknown) => { seen.push(v); return Promise.resolve([{ id: 1 }]); } }) } as unknown as Db;
  return { db, seen };
}

const base = { tenantId: 1, executionId: 7, toolName: 'run_command', category: 'shell', ts: new Date() };

describe('insertToolAudit', () => {
  it('redacts a single row before the insert', async () => {
    const { db, seen } = fakeDb();
    await insertToolAudit(db, { ...base, args: JSON.stringify({ env: { password: 'nestedpassword1' }, cmd: 'tool --token "quotedsecret99"' }), result: 'AWS_ACCESS_KEY_ID=AKIA' + 'IOSFODNN7EXAMPLE' });
    const row = seen[0] as { args: string; result: string };
    expect(JSON.parse(row.args).env.password).toBe('[REDACTED]');
    expect(row.args).not.toContain('quotedsecret99');
    expect(row.result).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('redacts every row of a batch and keeps a batch a batch', async () => {
    const { db, seen } = fakeDb();
    await insertToolAudit(db, [
      { ...base, result: 'GITHUB_TOKEN=ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4' },
      { ...base, args: null, result: null },
    ]);
    const rows = seen[0] as Array<{ result: string | null }>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows[0]!.result).not.toContain('a1B2c3D4e5F6g7H8i9J0k1L2m3N4');
    expect(rows[1]!.result).toBeNull();
  });
});
