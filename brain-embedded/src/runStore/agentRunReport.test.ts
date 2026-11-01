/**
 * What a settled Brain run reports to the door (PRD 35 §8.2): ONE report per run, carrying the entry point the host declared, and the
 * grade callback (`reportOutcome`) doing exactly what it does on the Brain's loop. On the agent engine a run with no coder grade has its
 * uniform record reported through its OWN port (`reportRunRecord`: recorded, never taught to routing); a graded run reports through
 * `reportOutcome` alone, the agent's telemetry riding on it as optional fields. Started through the real `startRun`.
 */
import { describe, expect, it } from 'vitest';
import { runScenario } from './../run/parity/harness';
import { bulk, call, calls, reply } from './../run/parity/script';
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
    it(`${entryPoint}: on the agent engine the run's record goes through its own port, once, recorded and never taught`, async () => {
      const records: Record[] = [];
      const record = await runScenario(chat(entryPoint, records), 'agent');
      // The grade callback is exactly the loop's: a run with no grade does not reach it.
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

  it('on the loop engine a run with no coder grade reports nothing, as before', async () => {
    const records: Record[] = [];
    const record = await runScenario(chat('vscode', records), 'loop');
    expect(record.outcome.reported).toEqual([]);
    expect(records).toEqual([]);
  });

  it('a graded run reports through the grade callback alone, once, with the loop source and fields and the agent telemetry as extras', async () => {
    const records: Record[] = [];
    const emptyHanded: Scenario = {
      id: 'report-graded',
      rows: [],
      title: 'a run asked for a change that read and delivered none',
      async run(host) {
        host.tools({ list_files: () => ({ ok: true, paths: [] }) });
        host.script([...Array.from({ length: 22 }, (_, i) => calls([call('list_files', { i }, 'c' + i)])), reply('I read everything.')]);
        await host.start({ userTurn: 'Please fix the bug in the handler.', entryPoint: 'web', reportRunRecord: async (r) => { records.push(r as Record); } });
      },
    };
    const loop = await runScenario(emptyHanded, 'loop');
    const agent = await runScenario(emptyHanded, 'agent');
    expect(loop.outcome.reported).toHaveLength(1);
    expect(agent.outcome.reported).toHaveLength(1);
    // The grade is the loop: same runs, same source, same fields; the agent adds only the optional §8.2 telemetry.
    expect(agent.outcome.reported[0]).toMatchObject(loop.outcome.reported[0] as object);
    expect((agent.outcome.reported[0] as Record).source).toBe('ide');
    expect(agent.outcome.reported[0]).toMatchObject({ entryPoint: 'web' });
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
    const record = await runScenario(longChat, 'agent');
    expect(record.scenarioError).toBeUndefined();
    expect(Object.values(record.trace).flat().filter((e) => (e as { label?: string }).label === 'context.compacted').length).toBeGreaterThanOrEqual(1);
    expect(records[0]).toMatchObject({ compactions: 1 });
  });
});
