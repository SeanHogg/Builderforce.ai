/**
 * What a settled Brain run reports to the door (PRD 35 §8.2): ONE record per run, carrying the entry point the host declared.
 * On the agent engine the uniform row is merged into the coder's grade (or stands alone, recorded but never taught, when the run made
 * no grade); on the Brain's own loop nothing changes. Started through the real `startRun` (the parity harness's host).
 */
import { describe, expect, it } from 'vitest';
import { runScenario } from './../run/parity/harness';
import { bulk, call, calls, reply } from './../run/parity/script';
import type { Scenario } from './../run/parity/types';
import type { RunEntryPoint } from './runTypes';

const chat = (entryPoint: RunEntryPoint): Scenario => ({
  id: `report-${entryPoint}`,
  rows: [],
  title: 'a chat run that changes no code',
  async run(host) {
    host.tools({ list_files: () => ({ ok: true, paths: [] }) });
    host.script([calls([call('list_files', {})]), reply('Hello! Done.')]);
    await host.start({ entryPoint });
  },
});

describe('the report a settled Brain run makes', () => {
  for (const [entryPoint, source] of [['vscode', 'ide'], ['web', 'external'], ['rovr', 'external']] as const) {
    it(`${entryPoint}: on the agent engine one record, the agent's row labelled for the surface, recorded and never taught`, async () => {
      const record = await runScenario(chat(entryPoint), 'agent');
      expect(record.outcome.reported).toHaveLength(1);
      expect(record.outcome.reported[0]).toMatchObject({
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
    const record = await runScenario(chat('vscode'), 'loop');
    expect(record.outcome.reported).toEqual([]);
  });

  it('counts a compaction once per FOLD, not once per turn that carries the fold', async () => {
    const longChat: Scenario = {
      id: 'report-fold',
      rows: [],
      title: 'a long chat folds once and runs two turns on the folded window',
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
        await host.start({ seed, seedIds, userTurn: 'And what about the manifest?', userTurnMessageId });
      },
    };
    const record = await runScenario(longChat, 'agent');
    expect(record.scenarioError).toBeUndefined();
    // One real fold, carried by two turns (the tool turn and the answer): one compaction.
    expect(Object.values(record.trace).flat().filter((e) => (e as { label?: string }).label === 'context.compacted').length).toBeGreaterThanOrEqual(1);
    expect(record.outcome.reported[0]).toMatchObject({ compactions: 1 });
  });
});
