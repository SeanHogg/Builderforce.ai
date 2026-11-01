/**
 * The Brain's entry points under the ONE scripted task (PRD 35 §3.3): the task, script, trace and answer are the shared
 * ones from `@builderforce/agent-run` (`conformanceTask.ts`), so web, Rovr and VS Code are held to the same
 * `RunEvent` trace and `RunOutcome` as the cloud, canvas, on-prem and channel adapters, not merely to each other. The
 * ports are the real ones (`buildBrainRunPorts` over a real run cell); the run is driven by `runAgent`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONFORMANCE_ANSWER,
  CONFORMANCE_SCRIPT,
  CONFORMANCE_TRACE,
  conformanceTrace,
  runAgent,
  teeEvents,
  type RunEvent,
  type RunOutcome,
} from '@builderforce/agent-run';
import { resetBrainRunStore } from './runStore/runControl';
import { resetRunSteering } from './runSteering';
import { binding, result, scripted } from './test/brainRunHarness';
import { brainRunPolicy, brainRunTask, buildBrainRunPorts, type BrainEntryPoint } from './run/webAdapter';

const ENTRY_POINTS: readonly BrainEntryPoint[] = ['vscode', 'web', 'rovr'];

/** The shared script in the stream's own result shape. */
const turns = CONFORMANCE_SCRIPT.map((c) => () =>
  result({
    text: c.content,
    toolCalls: (c.toolCalls ?? []).map((call) => ({ id: call.id, name: call.name, args: call.arguments })),
    ...(c.model ? { resolvedModel: c.model } : {}),
  }),
);

async function drive(entryPoint: BrainEntryPoint, runKey: number): Promise<{ events: RunEvent[]; outcome: RunOutcome }> {
  const { stream } = scripted(turns);
  const b = binding(runKey, stream, entryPoint);
  const ports = buildBrainRunPorts(b.binding);
  const events: RunEvent[] = [];
  ports.events = teeEvents(ports.events, events);
  const outcome = await runAgent({ task: brainRunTask(b.binding), policy: brainRunPolicy(b.binding), ports, signal: b.cell.abort?.signal });
  return { events, outcome };
}

beforeEach(() => {
  resetBrainRunStore();
  resetRunSteering();
});

describe('the Brain under the shared scripted task', () => {
  for (const [i, entryPoint] of ENTRY_POINTS.entries()) {
    it(`${entryPoint}: the shared RunEvent trace and the shared answer`, async () => {
      const { events, outcome } = await drive(entryPoint, 8300 + i);
      expect(conformanceTrace(events)).toEqual(CONFORMANCE_TRACE);
      expect(outcome).toMatchObject({ kind: 'finished', output: CONFORMANCE_ANSWER });
    });
  }
});
