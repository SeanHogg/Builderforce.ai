/**
 * The Rovr host declares itself and reports (PRD 35 §8.2): the run it prepares carries `entryPoint: 'rovr'` and the host's report port, so
 * the one agent's uniform outcome record is labelled by the host and reaches the gateway's door ONCE. Proved end to end: Rovr's
 * `prepareRun` laid over a request, started on the agent engine through the real `startRun`, and the record the port is told.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resetBrainRunStore, startRun, type BrainRunRequest, type BrainStreamFn, type StreamChatResult } from '@seanhogg/builderforce-brain-embedded';
import { createLocalFirstPersistence } from '../persistence/localFirstPersistence';
import { createRovrBrainPersistence } from '../persistence/rovrBrainPersistence';
import { createMemoryRecords } from '../store/records';
import { createRovrRunHost } from './rovrRunHost';

afterEach(() => resetBrainRunStore());

describe("Rovr's host labels its runs and reports them", () => {
  it("prepares a run for the 'rovr' entry point, and the door hears one record that says so, recorded and never taught", async () => {
    const records = createMemoryRecords();
    const persistence = createRovrBrainPersistence(records, createLocalFirstPersistence(records, { enqueue: () => undefined }));
    const reported: Array<Parameters<NonNullable<BrainRunRequest['reportRunRecord']>>[0]> = [];
    const host = createRovrRunHost({
      catalog: async () => ({ specs: [], run: async () => ({ ok: true }), needsConfirm: () => false }),
      systemPrompt: async () => 'You are Rovr.',
      reportRunRecord: async (record) => { reported.push(record); },
    });
    const id = -9100;
    const prepared = await host.prepareRun(id);
    expect(prepared.entryPoint).toBe('rovr');

    const stream: BrainStreamFn = async () => ({ text: 'Hi.', toolCalls: [], finishReason: 'stop', resolvedModel: 'fake-model' }) as StreamChatResult;
    await persistence.sendMessages(id, [{ role: 'user', content: 'hello' }]);
    await startRun(id, { resolvedSystemPrompt: '', stream, persistence, userTurn: 'hello', ...prepared });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({ entryPoint: 'rovr', source: 'external', terminalStatus: 'completed', routingSignal: false });
  });
});
