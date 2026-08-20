import { describe, it, expect, vi } from 'vitest';
import { recordCloudToolEvent } from './cloudToolEvents';
import { setExecutionEventSinks, type ExecutionSubscriberEvent } from './executionEvents';
import type { Db } from '../../infrastructure/database/connection';

/** Insert stub that captures the row and returns the persisted id. */
function fakeDb(id: number | null = 900) {
  const rows: Array<Record<string, unknown>> = [];
  const db = {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        rows.push(row);
        return { returning: () => Promise.resolve(id == null ? [] : [{ id }]) };
      },
    }),
  } as unknown as Db;
  return { db, rows };
}

describe('recordCloudToolEvent', () => {
  it('pushes every persisted row onto the run’s live stream, carrying its row id', async () => {
    const seen: ExecutionSubscriberEvent[] = [];
    setExecutionEventSinks((e) => seen.push(e));
    const { db, rows } = fakeDb(900);

    await recordCloudToolEvent(db, {
      tenantId: 1, cloudAgentRef: 'agent-a', executionId: 31,
      toolName: 'repo.write', category: 'code', result: 'ok', durationMs: 12,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: 'tool_event', executionId: 31, id: 900, cloudAgentRef: 'agent-a',
      toolName: 'repo.write', category: 'code', result: 'ok', durationMs: 12,
    });
    // The pushed timestamp IS the persisted one — a client merging the live tail
    // with a REST backfill must not see two different times for one event.
    expect((seen[0] as { ts: string }).ts).toBe((rows[0]?.ts as Date).toISOString());
    setExecutionEventSinks();
  });

  it('does not push a task-scoped row (no execution to stream it to)', async () => {
    const seen: ExecutionSubscriberEvent[] = [];
    setExecutionEventSinks((e) => seen.push(e));
    const { db } = fakeDb();

    await recordCloudToolEvent(db, {
      tenantId: 1, executionId: null, sessionKey: 'task:5', toolName: 'pr_opened', category: 'vcs',
    });

    expect(seen).toHaveLength(0);
    setExecutionEventSinks();
  });

  it('never throws when the insert fails, and pushes nothing it did not persist', async () => {
    const seen: ExecutionSubscriberEvent[] = [];
    setExecutionEventSinks((e) => seen.push(e));
    const db = { insert: () => ({ values: () => ({ returning: () => Promise.reject(new Error('db down')) }) }) } as unknown as Db;

    await expect(recordCloudToolEvent(db, { tenantId: 1, executionId: 31, toolName: 'x', category: 'y' })).resolves.toBeUndefined();
    expect(seen).toHaveLength(0);
    setExecutionEventSinks();
  });
});
