/**
 * The Brain's adapters under the conformance suite (PRD 35 §3.3, §4 WS4), on the REAL ports:
 * `buildBrainRunPorts` / `brainRunPolicy` / `brainRunTask` over a real run cell, driven by
 * `runAgent`. The web, Rovr and VS Code entry points differ ONLY by the label their outcome
 * row carries - so one scripted task must give the SAME `RunEvent` trace and `RunOutcome` on
 * each, and the surface behaviours the Brain keeps (Stop, a steer that interrupts, the model
 * preflight, the window-sized result cap) must hold on each.
 *
 * Lives here, beside the ports, rather than in `packages/agent-run/test/conformance`: that
 * package is installed on its own and cannot import this one's modules.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { runAgent, type RunEvent, type RunOutcome, type RunOutcomeRow } from '@builderforce/agent-run';
import { resetBrainRunStore, stopRun } from '../runStore/runControl';
import { queueRunSteering, resetRunSteering } from '../runSteering';
import { binding, result, scripted } from '../test/brainRunHarness';
import { brainRunPolicy, brainRunTask, buildBrainRunPorts, type BrainEntryPoint } from './webAdapter';

const ENTRY_POINTS: readonly BrainEntryPoint[] = ['vscode', 'web', 'rovr'];

/** Drive one scripted run through the real ports, recording the trace and the outcome row. */
async function drive(
  entryPoint: BrainEntryPoint,
  runKey: number,
  turns: Parameters<typeof scripted>[0],
  extra: Parameters<typeof binding>[3] = {},
  signalOf?: (cell: ReturnType<typeof binding>['cell']) => AbortSignal | undefined,
): Promise<{ events: RunEvent[]; rows: RunOutcomeRow[]; outcome: RunOutcome; asked: ReturnType<typeof scripted>['asked'] }> {
  const { stream, asked } = scripted(turns);
  const b = binding(runKey, stream, entryPoint, extra);
  const ports = buildBrainRunPorts(b.binding);
  const events: RunEvent[] = [];
  const rows: RunOutcomeRow[] = [];
  const sink = ports.events;
  ports.events = {
    emit: (event) => { events.push(event); return sink.emit(event); },
    outcome: async (row) => { rows.push(row); await sink.outcome?.(row); },
  };
  const outcome = await runAgent({
    task: brainRunTask(b.binding),
    policy: brainRunPolicy(b.binding),
    ports,
    signal: signalOf ? signalOf(b.cell) : b.cell.abort?.signal,
  });
  return { events, rows, outcome, asked };
}

beforeEach(() => {
  resetBrainRunStore();
  resetRunSteering();
});

describe('conformance - the Brain\'s entry points run the same task the same way', () => {
  it('gives one RunEvent trace and one outcome on vscode, web and rovr', async () => {
    const runs = await Promise.all(ENTRY_POINTS.map((entryPoint, i) => drive(entryPoint, 8200 + i, [() => result({ text: 'Hello! Done.' })])));
    const [first, ...rest] = runs;
    for (const other of rest) {
      expect(other.events).toEqual(first!.events);
      expect(other.outcome.kind).toEqual(first!.outcome.kind);
    }
    expect(first!.outcome).toMatchObject({ kind: 'finished' });
    expect(first!.events[0]?.kind).toBe('run.started');
    expect(first!.events.at(-1)?.kind).toBe('run.finished');
  });

  it('stamps the surface\'s label on the uniform outcome row - and nothing else about the run changes', async () => {
    const runs = await Promise.all(ENTRY_POINTS.map((entryPoint, i) => drive(entryPoint, 8210 + i, [() => result({ text: 'Hello! Done.' })])));
    runs.forEach((run, i) => {
      expect(run.rows).toHaveLength(1);
      expect(run.rows[0]?.entryPoint).toBe(ENTRY_POINTS[i]);
    });
    const { entryPoint: _first, ...baseline } = runs[0]!.rows[0]!;
    for (const run of runs.slice(1)) {
      const { entryPoint: _other, ...row } = run.rows[0]!;
      expect(row).toEqual(baseline);
    }
  });

  it('opens with the model preflight, which names an unresolved account on every surface', async () => {
    for (const [i, entryPoint] of ENTRY_POINTS.entries()) {
      const { events } = await drive(entryPoint, 8220 + i, [() => result({ text: 'Done.' })], {
        modelPreflight: async () => ({ byoUnresolved: ['anthropic:expired'] }),
      });
      expect(events[0]?.kind).toBe('run.started');
      expect(events[1]).toMatchObject({ kind: 'model.preflight', status: 'degraded' });
    }
  });
});

describe('conformance - Stop and steer on the Brain\'s surfaces', () => {
  it('a Stop on the cell settles the run cancelled and the model is never asked again', async () => {
    for (const [i, entryPoint] of ENTRY_POINTS.entries()) {
      const runKey = 8230 + i;
      const { outcome, asked } = await drive(entryPoint, runKey, [
        () => {
          stopRun(runKey);
          return result({ toolCalls: [{ id: 'c1', name: 'list_files', args: '{}' }] });
        },
        () => result({ text: 'never asked' }),
      ]);
      expect(outcome).toMatchObject({ kind: 'failed', reason: 'cancelled' });
      expect(asked).toHaveLength(1);
    }
  });

  it('a message steered mid-run interrupts the turn and is in front of the very next model call', async () => {
    for (const [i, entryPoint] of ENTRY_POINTS.entries()) {
      const runKey = 8240 + i;
      const { events, asked } = await drive(entryPoint, runKey, [
        () => {
          queueRunSteering(runKey, 'write the update now', { interrupt: true, fromPerson: true });
          return result({ toolCalls: [{ id: 'c1', name: 'list_files', args: '{}' }] });
        },
        () => result({ text: 'Done.' }),
      ]);
      expect(events.filter((e) => e.kind === 'steer.applied')).toHaveLength(1);
      expect(asked[1]?.messages.map((m) => m.content)).toContain('write the update now');
    }
  });

  it('the tools policy sizes its result cap from the transport\'s window on every surface', async () => {
    for (const [i, entryPoint] of ENTRY_POINTS.entries()) {
      const asked: string[] = [];
      await drive(entryPoint, 8250 + i, [() => result({ toolCalls: [{ id: 'c1', name: 'list_files', args: '{}' }] }), () => result({ text: 'Done.' })], {
        windowSources: { cloud: (ref) => { asked.push(ref); return 200_000; } },
      });
      expect(asked).toContain('fake-model');
    }
  });
});
