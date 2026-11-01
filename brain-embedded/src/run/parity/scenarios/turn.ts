/**
 * Area T of the parity rulings: the turn itself. What reaches the wire (T1 lives in `core.ts`), what is replayed (T4),
 * what rides the uncached tail (T5, T6), what is stamped on the call (T7), a re-ask that is discarded (T8), a provider
 * retry (T9), the preflight (T10), steering (T11), the budget stop (T13).
 */

import { StreamInterruptedError } from '../../../streamChatCompletion';
import { queueRunSteering } from '../../../runSteering';
import { calls, call, decide, fails, reply, completion } from '../script';
import type { Scenario } from '../types';

const FILES = {
  read_file: (a: unknown) => ({ ok: true, path: (a as { path?: string }).path, content: 'export const a = 1;\n', totalLines: 1 }),
  edit_file: () => ({ ok: true }),
};
const THINK = (thought: string, say: string) => `<think>${thought}</think>${say}`;

export const reasoningReplay: Scenario = {
  id: 'reasoning-replay', rows: ['T4'], title: 'a turn that reasons before a tool call is replayed without its <think> block, and no two assistant rows meet',
  async run(h) {
    h.tools(FILES);
    h.script([
      calls([call('read_file', { path: 'a.ts' }, 'c1')], { text: THINK('I should read a.ts first', 'Reading a.ts.') }),
      reply(THINK('the file is tiny', 'It exports a.')),
    ]);
    await h.start({ userTurn: 'What does a.ts export?' });
  },
};

export const focusFilesOnce: Scenario = {
  id: 'focus-files-once', rows: ['T5'], title: 'the host serves a focus file once through turnContext; later requests do not re-render it, and an edit does not leave it stale',
  async run(h) {
    h.tools(FILES);
    h.script([
      calls([call('read_file', { path: 'docs/a.md' }, 'c1')]),
      calls([call('edit_file', { path: 'docs/a.md', old: 'one', new: 'ONE' }, 'c2')]),
      reply('Edited docs/a.md.'),
    ]);
    await h.start({
      turnContext: async () => '### Focus file `docs/a.md` (2 lines, whole file)\none\ntwo',
      servedReads: async () => [{ path: 'docs/a.md', content: 'one\ntwo', totalLines: 2 }],
      userTurn: 'Change one to ONE in docs/a.md.',
    });
  },
};

export const ledgerInTail: Scenario = {
  id: 'ledger-in-tail', rows: ['T6'], title: 'the run knowledge ledger rides the volatile tail of each tool-bearing request',
  async run(h) {
    h.tools(FILES);
    h.script([
      calls([call('read_file', { path: 'a.ts' }, 'c1')]),
      calls([call('read_file', { path: 'b.ts' }, 'c2')]),
      calls([call('edit_file', { path: 'a.ts', old: 'a', new: 'b' }, 'c3')]),
      reply('Changed a.ts after reading both files.'),
    ]);
    await h.start({ userTurn: 'Rename a to b in a.ts.' });
  },
};

export const memorySavings: Scenario = {
  id: 'memory-savings', rows: ['T7'], title: 'a recalled memory block is stamped once on the first request of a call, not on a retry',
  async run(h) {
    h.tools(FILES);
    h.script([
      fails(new StreamInterruptedError('the model failed mid-answer: overloaded', 'x/model-a')),
      calls([call('read_file', { path: 'a.ts' }, 'c1')]),
      reply('It exports a, as the project notes say.'),
    ]);
    await h.start({
      evermind: {
        recall: async () => ({
          seeded: true, version: 3, mode: 'connected',
          items: [{ id: 1, tier: 'project', text: 'a.ts exports the constant a; the notes say not to rename it.', score: 0.9 }],
        }),
      },
      userTurn: 'What does a.ts export?',
    });
  },
};

export const retractedReask: Scenario = {
  id: 'reask-discarded', rows: ['T8'], title: 'the coder re-ask discards the planner\'s first edit turn: nothing durable or counted survives it',
  async run(h) {
    h.tools(FILES);
    h.script([
      calls([call('edit_file', { path: 'a.ts', old: 'a', new: 'b' }, 'e1')], { text: 'I will edit a.ts.', resolvedModel: 'direct/qwen/qwen3.8-max' }),
      calls([call('edit_file', { path: 'a.ts', old: 'a', new: 'b' }, 'e2')], { text: 'Editing a.ts.', resolvedModel: 'claude-opus-5' }),
      reply('Edited a.ts.', { resolvedModel: 'claude-opus-5' }),
    ]);
    await h.start({ userTurn: 'fix a.ts' });
  },
};

export const failedReask: Scenario = {
  id: 'reask-fails', rows: ['T8'], title: 'a coder re-ask that fails records its error step like any failed turn',
  async run(h) {
    h.tools(FILES);
    h.script([
      calls([call('edit_file', { path: 'a.ts', old: 'a', new: 'b' }, 'e1')], { text: 'I will edit a.ts.', resolvedModel: 'direct/qwen/qwen3.8-max' }),
      fails(new Error('coder unavailable')),
    ]);
    await h.start({ userTurn: 'fix a.ts' });
  },
};

export const retryOnForcedTurn: Scenario = {
  id: 'retry-forced-turn', rows: ['T9'], title: 'a transport failure on the forced hand_off turn retries with the same menu and brief, spending nothing forced twice',
  async run(h) {
    h.tools({ read_file: (a) => ({ ok: true, content: `body ${JSON.stringify(a)}` }), builtin_tasks_create: () => ({ id: 901 }), spawn_agents: () => ({ ok: true }) });
    let reads = 0;
    let failedOnce = false;
    h.react(decide(({ opts }) => {
      const names = (opts.tools ?? []).map((t) => t.function.name);
      const forced = names.length === 1 && names[0] === 'hand_off';
      if (forced && !failedOnce) { failedOnce = true; throw new StreamInterruptedError('the model failed mid-answer: overloaded', 'x/model-a'); }
      if (forced) return completion({ text: 'Analysis done.', toolCalls: [call('hand_off', { summary: 'a.ts is simple', tasks: [{ title: 'Edit a', brief: 'Edit a.ts', paths: ['a.ts'] }] }, 'h1')], finishReason: 'tool_calls' });
      if (opts.role === 'plan') { reads += 1; return completion({ toolCalls: [call('read_file', { path: `f${reads}.ts` }, `r${reads}`)], finishReason: 'tool_calls' }); }
      return completion({ text: 'Done.' });
    }));
    await h.start({ projectId: 11, userTurn: 'remove the title from the top of the VSIX' });
  },
};

export const preflightOnce: Scenario = {
  id: 'preflight-once', rows: ['T10'], title: 'the model preflight runs once and is recorded once before the first turn',
  async run(h) {
    h.tools(FILES);
    h.script([calls([call('read_file', { path: 'a.ts' }, 'c1')]), reply('Done reading.')]);
    await h.start({ modelPreflight: async () => ({ byoUnresolved: ['anthropic:expired'], fallback: 'free-model' }), userTurn: 'read a.ts' });
  },
};

export const steerDuringTool: Scenario = {
  id: 'steer-during-tool', rows: ['T11'], title: 'a person\'s steer sent while a tool runs interrupts, is applied once, and is marked as their ask',
  async run(h) {
    h.tools({ read_file: async () => { queueRunSteering(h.key, 'only the API half', { interrupt: true, fromPerson: true, persist: true }); return { ok: true, content: 'body' }; } });
    h.script([calls([call('read_file', { path: 'a.ts' }, 'c1')]), reply('Done with the API half.')]);
    await h.start({ userTurn: 'port it' });
  },
};

export const steerOnFinalAnswer: Scenario = {
  id: 'steer-final-answer', rows: ['T11', 'R2'], title: 'a steer that arrives with the final answer re-opens the run and the answer survives it',
  async run(h) {
    h.tools(FILES);
    h.script([
      () => { queueRunSteering(h.key, 'also cover the edge case', { fromPerson: true, persist: true }); return completion({ text: 'All done, the port is complete.' }); },
      reply('Edge case covered too.'),
    ]);
    await h.start({ userTurn: 'do it' });
  },
};

export const noStopWordMidRun: Scenario = {
  id: 'steer-stop-word', rows: ['T11'], title: 'a steer reading "stop" mid-run is direction like any other: the run has no stop-word check',
  async run(h) {
    h.tools({ read_file: () => { queueRunSteering(h.key, 'stop', { interrupt: true, fromPerson: true, persist: true }); return { ok: true, content: 'body' }; } });
    h.script([calls([call('read_file', { path: 'a.ts' }, 'c1')]), reply('Stopping here, as asked.')]);
    await h.start({ userTurn: 'port it' });
  },
};

export const budgetWarnAndStop: Scenario = {
  id: 'budget-warn-stop', rows: ['T13'], title: 'a USD cap warns at 80% and stops at the cap; the stop message is not settled as a reply (no chip, no learn)',
  async run(h) {
    h.tools(FILES);
    const priced = { resolvedModel: 'claude-sonnet-4-5', usage: { prompt: 60_000, completion: 8_000 } };
    h.react(decide(({ call: n }) => completion({ toolCalls: [call('read_file', { path: `f${n}.ts` }, `c${n}`)], finishReason: 'tool_calls', ...priced })));
    await h.start({ maxRunBudgetUsd: 0.5, userTurn: 'read everything' });
  },
};

export const stepNumbering: Scenario = {
  id: 'step-numbering', rows: ['T14'], title: 'args.step numbers the turns of a three-turn run the way the loop does',
  async run(h) {
    h.tools(FILES);
    h.script([calls([call('read_file', { path: 'a.ts' }, 'c1')]), calls([call('read_file', { path: 'b.ts' }, 'c2')]), reply('Both read.')]);
    await h.start({ userTurn: 'read a and b' });
  },
};

export const turnScenarios: Scenario[] = [
  reasoningReplay, focusFilesOnce, ledgerInTail, memorySavings, retractedReask, failedReask, retryOnForcedTurn,
  preflightOnce, steerDuringTool, steerOnFinalAnswer, noStopWordMidRun, budgetWarnAndStop, stepNumbering,
];
