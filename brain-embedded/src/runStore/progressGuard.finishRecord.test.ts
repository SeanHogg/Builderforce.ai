import { describe, expect, it } from 'vitest';
import { initialRunPolicy } from '@builderforce/run-policy';
import type { BrainToolSpec } from '../streamChatCompletion';
import { makeCell } from './runCell';
import { runTrace } from './runCells';
import type { BrainRunContext } from './brainRunContext';
import { FINISH_RECORD_TURNS, RunProgressGuard, progressGuardTurn } from './progressGuard';

// VS Code chat #157440 (msgs #2215, #2468): the progress guard's forced finish offered ZERO tools, so a run ended mid-task
// could not record the requested items it had not done. The finish now offers ONLY the obligation (ticket) tools.

const spec = (name: string): BrainToolSpec => ({ type: 'function', function: { name, description: '', parameters: { type: 'object', properties: {} } } }) as BrainToolSpec;
const OBLIGATION = ['builtin_tasks_create', 'builtin_tasks_update', 'builtin_tickets_from_delta', 'builtin_chats_list_tickets'];
const CATALOG = ['read_file', 'edit_file', 'write_file', 'run_command', 'ask_user', 'builtin_kanban_coordinate', 'builtin_chats_link_ticket', ...OBLIGATION].map(spec);
const SELECTED = ['read_file', 'search_code', 'edit_file', 'write_file', 'ask_user'].map(spec);

function runOf(obligation: readonly string[]): BrainRunContext {
  const c = makeCell();
  c.codeChanged = true;
  return {
    c,
    canAskUser: true,
    metadata: { mode: 'work' },
    userRequest: 'For all the items that are incomplete, create associated tickets to this chat',
    usedTools: new Set<string>(),
    allTools: CATALOG,
    promptTools: { system: [], turn: [], contract: [], obligation },
    policy: initialRunPolicy({ startPhase: 'code' }),
    progress: new RunProgressGuard(true, true),
  } as unknown as BrainRunContext;
}

/** Drive the guard to a verified idle finish (the same ladder `progressGuard.finish.test.ts` walks). */
function tripFinish(run: BrainRunContext): void {
  const g = run.progress;
  g.observe('edit_file', { edits: [{ path: 'src/a.tsx', old_string: 'x', new_string: 'y' }] }, { data: { ok: true } });
  g.endTurn();
  g.observe('run_command', { command: 'pnpm exec tsc --noEmit', background: true }, { data: { ok: true, background: true, id: 'job-1', status: 'running' } });
  g.endTurn();
  g.observe('command_status', { id: 'job-1' }, { data: { ok: true, id: 'job-1', status: 'exited', exitCode: 0, output: '' } });
  g.endTurn();
  const idle = () => {
    let action = null;
    for (let i = 0; i < 4 && !action; i++) {
      g.observe('git_status', {}, { data: { ok: true, stdout: '' } });
      action = g.endTurn();
    }
    return action;
  };
  expect(idle()?.kind).toBe('steer');
  expect(progressGuardTurn(run, 7, SELECTED)).toBeNull();
  expect(idle()?.kind).toBe('finish');
}

const names = (tools: readonly BrainToolSpec[] | undefined) => (tools ?? []).map((t) => t.function.name);

describe('regression: chat #157440 — a forced finish offers only the obligation tools', () => {
  it('regression: the finish turn offers the ticket obligations, no write/exec/ask tool, and says to file what is still open', () => {
    const run = runOf(OBLIGATION);
    tripFinish(run);
    const turn = progressGuardTurn(run, 11, SELECTED);
    expect(names(turn?.tools).sort()).toEqual([...OBLIGATION].sort());
    for (const banned of ['edit_file', 'write_file', 'run_command', 'read_file', 'ask_user', 'builtin_kanban_coordinate']) expect(names(turn?.tools)).not.toContain(banned);
    expect(turn?.toolChoice).toBeUndefined();
    const brief = String(turn?.brief.content);
    expect(brief).toMatch(/final report/i);
    expect(brief).toMatch(/file a ticket for EVERY item/i);
    expect(brief).toMatch(/no more code changes/i);
    const forced = runTrace(run.c).filter((e) => e.label === 'loop.progress_forced');
    expect(forced.map((e) => (e.args as { recordTools?: number }).recordTools)).toEqual([OBLIGATION.length]);
  });

  it('regression: finish stays finish — later turns offer only the obligations, then nothing', () => {
    const run = runOf(OBLIGATION);
    tripFinish(run);
    expect(names(progressGuardTurn(run, 11, SELECTED)?.tools)).toHaveLength(OBLIGATION.length);
    for (let i = 1; i < FINISH_RECORD_TURNS; i++) {
      // A ticket call ran; even a new trip never reopens the full menu.
      run.progress.observe('builtin_tasks_create', { title: `item ${i}` }, { data: { ok: true, id: i } });
      run.progress.endTurn();
      expect(names(progressGuardTurn(run, 11 + i, SELECTED)?.tools).sort()).toEqual([...OBLIGATION].sort());
    }
    const last = progressGuardTurn(run, 20, SELECTED);
    expect(last?.tools).toEqual([]);
    expect(String(last?.brief.content)).toMatch(/final report/i);
    // The finish is spent: an ordinary turn again only if something new is due.
    expect(progressGuardTurn(run, 21, SELECTED)).toBeNull();
  });

  it('a run with no obligations (chat mode, no ticket tools) still finishes with no tools', () => {
    const run = runOf([]);
    tripFinish(run);
    const turn = progressGuardTurn(run, 11, SELECTED);
    expect(turn?.tools).toEqual([]);
    expect(progressGuardTurn(run, 12, SELECTED)).toBeNull();
  });
});
