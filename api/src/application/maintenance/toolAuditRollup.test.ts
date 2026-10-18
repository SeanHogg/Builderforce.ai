import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { rollUpToolAudit } from './toolAuditRollup';

describe('toolAuditRollup retention gate', () => {
  it('opens app.retention in the same fold statement (SET LOCAL equivalent)', async () => {
    const sqls: string[] = [];
    const dump = (q: unknown): string => {
      const o = q as { toSQL?: () => { sql: string }; queryChunks?: unknown[]; value?: unknown };
      if (typeof o.toSQL === 'function') {
        try {
          const r = o.toSQL();
          if (r && typeof r.sql === 'string') return r.sql;
        } catch { /* sql`` fragments throw */ }
      }
      if (Array.isArray(o.queryChunks)) {
        return o.queryChunks.map((c) => (typeof c === 'string' ? c : dump(c))).join('');
      }
      if (o.value !== undefined) return String(o.value);
      return String(q);
    };
    const db = {
      execute: (q: unknown) => {
        sqls.push(dump(q));
        if (sqls.length === 1) return { rows: [{ day: '2026-01-01' }] };
        return { rows: [{ tallies: 0, folded: 0 }] };
      },
    };
    await rollUpToolAudit(db as unknown as Db, new Date('2026-03-01T00:00:00Z'), { maxDays: 1 });
    expect(sqls.some((s) => s.includes("set_config('app.retention', 'on', true)"))).toBe(true);
  });
});
