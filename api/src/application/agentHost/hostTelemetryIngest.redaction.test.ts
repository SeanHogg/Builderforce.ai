import { describe, expect, it } from 'vitest';
import { insertToolAuditRows, toolAuditRows } from './hostTelemetryIngest';
import type { Db } from '../../infrastructure/database/connection';

describe('host tool-audit ingest redaction', () => {
  it('stores a host-pushed tool event with its secrets redacted and its args still valid JSON', async () => {
    const ghp = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
    const stored: Array<Record<string, unknown>> = [];
    const db = { insert: () => ({ values: (v: Record<string, unknown>[]) => { stored.push(...v); return Promise.resolve(); } }) } as unknown as Db;
    const rows = toolAuditRows({ tenantId: 1, agentHostId: 2 }, [{
      toolName: 'run_command',
      executionId: 9,
      args: { command: `git push https://x:${ghp}@github.com/o/r.git`, env: { password: 'hunter2hunter2' } },
      result: `GITHUB_TOKEN=${ghp}\nDB_PASSWORD="my secret pass"`,
    }]);

    expect(await insertToolAuditRows(db, rows)).toBe(1);

    const row = stored[0]!;
    const text = `${row.args}\n${row.result}`;
    expect(text).not.toContain(ghp);
    expect(text).not.toContain('hunter2hunter2');
    expect(text).not.toContain('my secret pass');
    expect(() => JSON.parse(row.args as string)).not.toThrow();
  });
});
