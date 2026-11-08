import { describe, it, expect } from 'vitest';
import { recordCloudToolEvent } from './cloudToolEvents';
import type { Db } from '../../infrastructure/database/connection';

describe('recordCloudToolEvent redaction', () => {
  it('stores secret-shaped tool output redacted (an env dump never lands a token in tool_audit_events)', async () => {
    const rows: Array<Record<string, unknown>> = [];
    const db = {
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          rows.push(row);
          return { returning: () => Promise.resolve([{ id: 1 }]) };
        },
      }),
    } as unknown as Db;
    const ghp = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
    const aws = 'AKIA' + 'IOSFODNN7EXAMPLE';
    const bearer = 'eyJhbGciOiJIUzI1NiJ9abcdefghij1234567890';

    await recordCloudToolEvent(db, {
      tenantId: 1,
      executionId: 43,
      toolName: 'run_command',
      category: 'shell',
      detail: { command: `curl -H "Authorization: Bearer ${bearer}" https://x` },
      result: `PATH=/usr/bin\nGITHUB_TOKEN=${ghp}\nAWS_ACCESS_KEY_ID=${aws}\nAuthorization: Bearer ${bearer}\n`,
    });

    const row = rows[0]!;
    const stored = `${row.result as string}\n${row.args as string}`;
    expect(stored).not.toContain(ghp);
    expect(stored).not.toContain(aws);
    expect(stored).not.toContain(bearer);
    expect(row.result as string).toContain('PATH=/usr/bin');
  });
});
