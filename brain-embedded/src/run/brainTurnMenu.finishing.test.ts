import { describe, expect, it } from 'vitest';
import { initialRunPolicy } from '@builderforce/run-policy';
import type { TurnEnv } from '@builderforce/agent-run';
import type { BrainToolSpec } from '../streamChatCompletion';
import { makeCell } from '../runStore/runCell';
import type { BrainRunContext } from '../runStore/brainRunContext';
import { FINISH_RECORD_BRIEF, RunProgressGuard } from '../runStore/progressGuard';
import { brainTurnMenu } from './brainTurnMenu';

// VS Code chat #157440 (fix round): a run that had not changed anything was FINISHING (its record turns, with the ticket tools)
// but the change budget's "STOP READING" turn was asked first and pre-empted it — the run could not record the open work.

const spec = (name: string): BrainToolSpec => ({ type: 'function', function: { name, description: '', parameters: { type: 'object', properties: {} } } }) as BrainToolSpec;
const OBLIGATION = ['builtin_tasks_create', 'builtin_tasks_update', 'builtin_tickets_from_delta'];
const SELECTED = ['read_file', 'search_code', 'edit_file', 'write_file', 'ask_user'].map(spec);
const CATALOG = [...SELECTED, ...OBLIGATION.map(spec)];

/** A coding run that has spent its change budget without changing anything — the change budget's turn is due. */
function stalledRun(): BrainRunContext {
  return {
    c: makeCell(),
    canAskUser: true,
    metadata: { mode: 'work' },
    userRequest: 'Review the PRD and create tickets for the open items, then fix the first one',
    usedTools: new Set<string>(),
    allTools: CATALOG,
    promptTools: { system: [], turn: [], contract: [], obligation: OBLIGATION },
    policy: { ...initialRunPolicy({ startPhase: 'code' }), codeTurns: 40 },
    pipeline: null,
    progress: new RunProgressGuard(true, true),
  } as unknown as BrainRunContext;
}

const envAt = (step: number): TurnEnv => ({ step, select: async () => SELECTED, progress: {}, cache: {} }) as unknown as TurnEnv;
const names = (tools: readonly unknown[] | undefined) => (tools ?? []).map((t) => (t as BrainToolSpec).function.name);
const tailText = (tail: readonly unknown[] | undefined) => (tail ?? []).map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join('\n');

describe('regression: chat #157440 — a finishing run gets its record turn before any change-only turn', () => {
  it('control: the same stalled run, not finishing, is forced to change ("STOP READING")', async () => {
    const menu = await brainTurnMenu(stalledRun(), envAt(41), CATALOG.length);
    expect(tailText(menu?.tail)).toContain('STOP READING');
  });

  it('regression: a no-progress run in finishing mode gets the record turn with the obligation tools, not "STOP READING"', async () => {
    const run = stalledRun();
    run.progress.beginRecordingFinish(2);
    const menu = await brainTurnMenu(run, envAt(41), CATALOG.length);
    expect(names(menu?.tools).sort()).toEqual([...OBLIGATION].sort());
    expect(menu?.toolChoice).toBeUndefined();
    const tail = tailText(menu?.tail);
    expect(tail).not.toContain('STOP READING');
    expect(tail).toContain(FINISH_RECORD_BRIEF.slice(0, 40));
  });

  it('regression: chat #128305 — the finishing run\'s last (no-tool) turn is marked FINAL; its record turns are not, and finishing is sticky', async () => {
    const run = stalledRun();
    expect(run.progress.finishing).toBe(false);
    run.progress.beginRecordingFinish(1);
    const record = await brainTurnMenu(run, envAt(41), CATALOG.length);
    expect(names(record?.tools).length).toBeGreaterThan(0);
    expect(record && 'final' in record ? record.final : undefined).toBeUndefined();
    expect(run.progress.finishing).toBe(true);
    const last = await brainTurnMenu(run, envAt(42), CATALOG.length);
    expect(last?.tools).toEqual([]);
    expect(last?.final).toBe(true);
    // The finish is spent, the run is not un-finished: a later ordinary menu leaves `finishing` set.
    await brainTurnMenu(run, envAt(43), CATALOG.length);
    expect(run.progress.finishing).toBe(true);
  });

  it('a finish / record turn never carries the steer note', async () => {
    const run = stalledRun();
    run.progress.beginRecordingFinish(1);
    run.progress.steerInstead('PROGRESS CHECK steer: keep going');
    const menu = await brainTurnMenu(run, envAt(41), CATALOG.length);
    expect(tailText(menu?.tail)).not.toContain('PROGRESS CHECK steer');
  });
});
