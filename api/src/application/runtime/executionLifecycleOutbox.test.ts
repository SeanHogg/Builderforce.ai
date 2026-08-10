import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { activityLog, executionLifecycleOutbox } from '../../infrastructure/database/schema';
import {
  drainExecutionLifecycleOutbox,
  lifecycleOutboxBackoffMs,
} from './executionLifecycleOutbox';

const dueRow = {
  id: 11,
  eventKey: 'execution:42:v:2:completed',
  tenantId: 7,
  executionId: 42,
  taskId: 9,
  projectId: 3,
  lifecycleVersion: 2,
  eventType: 'execution.completed',
  fromStatus: 'running',
  toStatus: 'completed',
  submittedBy: 'system:lane-auto',
  agentHostId: null,
  cloudAgentRef: 'coder',
  mode: 'live',
  payload: { status: 'completed', hasResult: true },
  status: 'pending',
  attempts: 0,
  nextAttemptAt: new Date(),
  lastError: null,
  processedAt: null,
  occurredAt: new Date('2026-07-26T12:00:00Z'),
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeDb(opts: { insertError?: Error } = {}) {
  const activityRows: Record<string, unknown>[] = [];
  const updateSets: Record<string, unknown>[] = [];
  let updateCall = 0;

  const db = {
    select: () => ({
      from: (table: unknown) => {
        expect(table).toBe(executionLifecycleOutbox);
        return {
          where: () => ({
            orderBy: () => ({
              limit: async () => [dueRow],
            }),
          }),
        };
      },
    }),
    update: (table: unknown) => {
      expect(table).toBe(executionLifecycleOutbox);
      updateCall += 1;
      return {
        set: (patch: Record<string, unknown>) => {
          updateSets.push(patch);
          return {
            where: () => updateCall === 1
              ? { returning: async () => [{ id: dueRow.id }] }
              : Promise.resolve(),
          };
        },
      };
    },
    insert: (table: unknown) => {
      expect(table).toBe(activityLog);
      return {
        values: (row: Record<string, unknown>) => {
          activityRows.push(row);
          return {
            onConflictDoNothing: async () => {
              if (opts.insertError) throw opts.insertError;
            },
          };
        },
      };
    },
  } as unknown as Db;

  return { db, activityRows, updateSets };
}

describe('execution lifecycle outbox', () => {
  it('projects a correlated tenant event and acknowledges the outbox row', async () => {
    const { db, activityRows, updateSets } = makeDb();
    const result = await drainExecutionLifecycleOutbox({} as Env, db, { executionId: 42 });

    expect(result).toEqual({ claimed: 1, projected: 1, retried: 0, dead: 0 });
    expect(activityRows).toHaveLength(1);
    expect(activityRows[0]).toMatchObject({
      eventKey: dueRow.eventKey,
      tenantId: 7,
      projectId: 3,
      actorType: 'cloud_agent',
      actorRef: 'coder',
      verb: 'execution.completed',
      targetType: 'execution',
      targetId: '42',
    });
    expect(updateSets.at(-1)).toMatchObject({ status: 'done', lastError: null });
  });

  it('records a projection exception and schedules an idempotent retry', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { db, updateSets } = makeDb({ insertError: new Error('activity unavailable') });

    const result = await drainExecutionLifecycleOutbox({} as Env, db);

    expect(result).toEqual({ claimed: 1, projected: 0, retried: 1, dead: 0 });
    expect(updateSets.at(-1)).toMatchObject({
      status: 'retry',
      attempts: 1,
      lastError: 'Error: activity unavailable',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      '[caught-error]',
      expect.objectContaining({
        source: 'application/runtime/executionLifecycleOutbox.ts',
        operation: 'drainExecutionLifecycleOutbox',
        context: expect.objectContaining({
          details: expect.objectContaining({
            eventKey: dueRow.eventKey,
            executionId: 42,
            attempts: 1,
          }),
        }),
      }),
    );
    errorSpy.mockRestore();
  });

  it('uses capped exponential backoff', () => {
    expect(lifecycleOutboxBackoffMs(0)).toBe(1_000);
    expect(lifecycleOutboxBackoffMs(3)).toBe(8_000);
    expect(lifecycleOutboxBackoffMs(99)).toBe(60 * 60_000);
  });
});
