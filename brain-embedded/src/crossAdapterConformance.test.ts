/**
 * The Brain's entry points under the ONE scripted task (PRD 35 §3.3): web, Rovr and VS Code are held to the SAME `RunEvent` trace and
 * the same answer as the cloud, canvas, on-prem and channel adapters (the task, script and golden are `@builderforce/agent-run`'s
 * `conformanceTask.ts`).
 *
 * The run goes through the PRODUCTION binding, not a harness of its own: `startRun` -> `driveRun` -> `prepareRunLoop` -> `runPrepared`,
 * on `engine: 'agent'`, started the way a host starts it (the parity harness, `run/parity/harness.ts`; the fake is the model stream,
 * the persistence and the host's tool port, the three things a host supplies). The trace is read by wrapping the one `runAgent` call.
 */

import { describe, expect, it, vi } from 'vitest';
import type { RunEvent, RunOutcomeRow } from '@builderforce/agent-run';
import { runScenario } from './run/parity/harness';
import { call, calls, reply } from './run/parity/script';
import type { Scenario } from './run/parity/types';
import type { RunEntryPoint } from './runStore/runTypes';

const seen = vi.hoisted(() => ({ events: [] as RunEvent[], rows: [] as RunOutcomeRow[] }));

vi.mock('@builderforce/agent-run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@builderforce/agent-run')>();
  return {
    ...actual,
    runAgent: (input: Parameters<typeof actual.runAgent>[0]) =>
      actual.runAgent({
        ...input,
        ports: {
          ...input.ports,
          events: {
            ...actual.teeEvents(input.ports.events, seen.events),
            outcome: async (row: RunOutcomeRow) => {
              seen.rows.push(row);
              await input.ports.events.outcome?.(row);
            },
          },
        },
      }),
  };
});

const { CONFORMANCE_ANSWER, CONFORMANCE_PROMPT, CONFORMANCE_TOOL, CONFORMANCE_TRACE, conformanceTrace } = await import('@builderforce/agent-run');

const ENTRY_POINTS: readonly RunEntryPoint[] = ['vscode', 'web', 'rovr'];

const scenario = (entryPoint: RunEntryPoint): Scenario => ({
  id: `conformance-${entryPoint}`,
  rows: [],
  title: `the shared scripted task on ${entryPoint}`,
  async run(host) {
    host.tools({ [CONFORMANCE_TOOL]: () => ({ ok: true, paths: [] }) });
    host.script([calls([call(CONFORMANCE_TOOL, {})]), reply(CONFORMANCE_ANSWER)]);
    await host.start({ userTurn: CONFORMANCE_PROMPT, entryPoint });
  },
});

describe('the Brain under the shared scripted task, through startRun on the agent engine', () => {
  for (const entryPoint of ENTRY_POINTS) {
    it(`${entryPoint}: the shared RunEvent trace, the shared answer and a finished outcome row labelled for the surface`, async () => {
      seen.events.length = 0;
      seen.rows.length = 0;
      const record = await runScenario(scenario(entryPoint), 'agent');

      expect(record.scenarioError).toBeUndefined();
      expect(conformanceTrace(seen.events)).toEqual(CONFORMANCE_TRACE);
      expect(record.host.toolCalls.map((t) => t.name)).toEqual([CONFORMANCE_TOOL]);
      expect(record.persisted.filter((m) => m.role === 'assistant').at(-1)?.content).toBe(CONFORMANCE_ANSWER);
      // The outcome the run ended with is the uniform row: finished, and labelled with the surface the host declared.
      expect(seen.rows).toHaveLength(1);
      expect(seen.rows[0]).toMatchObject({ entryPoint, terminalStatus: 'finished' });
    });
  }
});
