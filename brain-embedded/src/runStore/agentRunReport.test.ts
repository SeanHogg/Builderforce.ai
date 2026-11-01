/**
 * What a settled Brain run reports to the door (PRD 35 §8.2): ONE report per run, carrying the entry point the host declared. A run with
 * no coder grade has its uniform record reported through its OWN port (`reportRunRecord`: recorded, never taught to routing); a graded
 * run reports through `reportOutcome` alone, the agent's telemetry riding on it as optional fields. Started through the real `startRun`.
 */
import { describe, expect, it } from 'vitest';
import { runScenario } from './../run/parity/harness';
import { bulk, call, calls, fails, reply, streamsUntilStopped } from './../run/parity/script';
import { brainRequestError } from './../chatError';
import { stopRun } from './runControl';
import type { Scenario } from './../run/parity/types';
import type { RunEntryPoint } from './runTypes';

type Record = { [key: string]: unknown };

const chat = (entryPoint: RunEntryPoint, records: Record[]): Scenario => ({
  id: `report-${entryPoint}`,
  rows: [],
  title: 'a chat run that changes no code',
  async run(host) {
    host.tools({ list_files: () => ({ ok: true, paths: [] }) });
    host.script([calls([call('list_files', {})]), reply('Hello! Done.')]);
    await host.start({ entryPoint, reportRunRecord: async (record) => { records.push(record as Record); } });
  },
});

describe('the report a settled Brain run makes', () => {
  for (const [entryPoint, source] of [['vscode', 'ide'], ['web', 'external'], ['rovr', 'external']] as const) {
    it(`${entryPoint}: the run's record goes through its own port, once, recorded and never taught`, async () => {
      const records: Record[] = [];
      const record = await runScenario(chat(entryPoint, records));
      // A run with no grade does not reach the grade callback.
      expect(record.outcome.reported).toEqual([]);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        entryPoint,
        source,
        terminalStatus: 'completed',
        steps: 2, // the Brain's own number: its completed model turns, the finishing one included
        toolCalls: 1,
        routingSignal: false,
      });
    });
  }

  describe('a run that ended before any model completed still reports once, naming the model it asked for', () => {
    const refused = (model: string | undefined, records: Record[]): Scenario => ({
      id: 'report-refused',
      rows: [],
      title: 'the gateway answers 402 to the first ask',
      async run(host) {
        host.script([fails(brainRequestError(402, { error: 'needs a validated card', code: 'card_required' }))]);
        await host.start({ ...(model ? { model } : {}), reportRunRecord: async (r) => { records.push(r as Record); } });
      },
    });

    it('a 402 refusal: one record, the requested model, failed, never taught to routing', async () => {
      const records: Record[] = [];
      const record = await runScenario(refused('xai-oauth/grok-4.5', records));
      expect(record.outcome.reported).toEqual([]);
      expect(record.outcome.ended).toHaveLength(1);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ model: 'xai-oauth/grok-4.5', terminalStatus: 'failed', steps: 0, routingSignal: false });
    });

    it('a 402 refusal with no model named: one record, under the word for "the gateway chooses"', async () => {
      const records: Record[] = [];
      await runScenario(refused(undefined, records));
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ model: 'default', terminalStatus: 'failed', routingSignal: false });
    });

    it('a Stop before the first token: one record, the model the stopped request named, cancelled, never taught', async () => {
      const records: Record[] = [];
      const stopped: Scenario = {
        id: 'report-stop-before-text',
        rows: [],
        title: 'Stop before a single token arrived',
        async run(host) {
          let streaming = false;
          host.script([streamsUntilStopped(() => { streaming = true; }, [], 'xai-oauth/grok-4.6')]);
          const run = host.begin({ userTurn: 'go', reportRunRecord: async (r) => { records.push(r as Record); } });
          await host.until(() => streaming, 'the request is open');
          stopRun(host.key);
          await run;
        },
      };
      const record = await runScenario(stopped);
      expect(record.outcome.reported).toEqual([]);
      expect(record.outcome.ended).toHaveLength(1);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ model: 'xai-oauth/grok-4.6', terminalStatus: 'cancelled', steps: 0, routingSignal: false });
    });
  });

  it('a graded run reports through the grade callback alone, once, with source ide and the agent telemetry as optional fields', async () => {
    const records: Record[] = [];
    // The parity record is NORMALISED (rule 7 drops the agent's 17 telemetry fields from `outcome.reported`), so the raw report is read here.
    const raw: Record[] = [];
    const emptyHanded: Scenario = {
      id: 'report-graded',
      rows: [],
      title: 'a run asked for a change that read and delivered none',
      async run(host) {
        host.tools({ list_files: () => ({ ok: true, paths: [] }) });
        host.script([...Array.from({ length: 22 }, (_, i) => calls([call('list_files', { i }, 'c' + i)])), reply('I read everything.')]);
        await host.start({ userTurn: 'Please fix the bug in the handler.', entryPoint: 'web', reportOutcome: async (o) => { raw.push(o as Record); }, reportRunRecord: async (r) => { records.push(r as Record); } });
      },
    };
    await runScenario(emptyHanded);
    // The host's own callback is told ONCE per run.
    expect(raw).toHaveLength(1);
    const [grade] = raw;
    expect(grade!.source).toBe('ide');
    // The grade carries the agent's §8.2 telemetry, as optional fields: the entry point the host declared among them.
    expect(grade).toMatchObject({ entryPoint: 'web', toolCalls: expect.any(Number), clientRunId: expect.any(String) });
    // One report per run: the record port is not also told.
    expect(records).toEqual([]);
  });

  it('counts a compaction once per FOLD, not once per turn that carries the fold', async () => {
    const records: Record[] = [];
    const longChat: Scenario = {
      id: 'report-fold',
      rows: [],
      title: 'a long chat folds once and runs three turns on the folded window',
      async run(host) {
        // A tool answer larger than the window lets the agent clip it, so its transcript differs from the cell's on every turn after.
        host.tools({ list_files: () => ({ ok: true, paths: [], listing: bulk('listing', 40_000) }) });
        host.script([calls([call('list_files', {}, 'c1')]), calls([call('list_files', {}, 'c2')]), reply('Done on the folded window.')], 'Memory: the earlier questions were about the manifest service.');
        host.preload(
          Array.from({ length: 20 }, (_, i) => [
            { role: 'user' as const, content: `Question ${i + 1}. ${bulk(`q${i + 1}`, 2_500)}` },
            { role: 'assistant' as const, content: `Answer ${i + 1}. ${bulk(`a${i + 1}`, 2_500)}` },
          ]).flat(),
        );
        const { seed, seedIds } = host.seedOf();
        const userTurnMessageId = host.saveUser('And what about the manifest?');
        await host.start({ seed, seedIds, userTurn: 'And what about the manifest?', userTurnMessageId, reportRunRecord: async (r) => { records.push(r as Record); } });
      },
    };
    const record = await runScenario(longChat);
    expect(record.scenarioError).toBeUndefined();
    expect(Object.values(record.trace).flat().filter((e) => (e as { label?: string }).label === 'context.compacted').length).toBeGreaterThanOrEqual(1);
    expect(records[0]).toMatchObject({ compactions: 1 });
  });
});
