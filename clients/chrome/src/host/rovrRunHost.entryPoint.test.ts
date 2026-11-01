/**
 * The Rovr host declares itself (PRD 35 §8.2): the run it prepares carries `entryPoint: 'rovr'`, so the one agent's uniform outcome row
 * is labelled by the host and not by a test argument. Proved end to end: Rovr's `prepareRun` laid over a request, started on the agent
 * engine through the real `startRun`, and the row the host is told.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resetBrainRunStore, startRun, type BrainStreamFn, type RunOutcomeRow, type StreamChatResult } from '@seanhogg/builderforce-brain-embedded';
import { createLocalFirstPersistence } from '../persistence/localFirstPersistence';
import { createRovrBrainPersistence } from '../persistence/rovrBrainPersistence';
import { createMemoryRecords } from '../store/records';
import { createRovrRunHost } from './rovrRunHost';

afterEach(() => resetBrainRunStore());

describe("Rovr's host labels its runs", () => {
  it("prepares a run for the 'rovr' entry point, and the agent's outcome row says so", async () => {
    const records = createMemoryRecords();
    const persistence = createRovrBrainPersistence(records, createLocalFirstPersistence(records, { enqueue: () => undefined }));
    const host = createRovrRunHost({
      catalog: async () => ({ specs: [], run: async () => ({ ok: true }), needsConfirm: () => false }),
      systemPrompt: async () => 'You are Rovr.',
    });
    const id = -9100;
    const prepared = await host.prepareRun(id);
    expect(prepared.entryPoint).toBe('rovr');

    const stream: BrainStreamFn = async () => ({ text: 'Hi.', toolCalls: [], finishReason: 'stop', resolvedModel: 'fake-model' }) as StreamChatResult;
    const rows: RunOutcomeRow[] = [];
    await persistence.sendMessages(id, [{ role: 'user', content: 'hello' }]);
    await startRun(id, {
      resolvedSystemPrompt: '',
      stream,
      persistence,
      userTurn: 'hello',
      ...prepared,
      engine: 'agent',
      reportRunRow: (row) => { rows.push(row); },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entryPoint: 'rovr', terminalStatus: 'finished' });
  });
});
