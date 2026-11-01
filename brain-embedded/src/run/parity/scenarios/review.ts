/**
 * The scenarios the parity review asked for, because a green suite would otherwise miss them: a small window under tool
 * calls, a Flash-priced pin and QUICK on Flash, a child report meeting the ship gate and an exhausted stall, a transport
 * failure on the coder re-ask, six failures in one turn, a wait that a steer interrupts, a steer before a command,
 * reasoning that mentions a next action, an image with a context pack, two steers at turn end, and a Stop during hand_off.
 */

import { stopRun } from '../../../runStore/runControl';
import { queueRunSteering } from '../../../runSteering';
import { childReportText } from '@builderforce/agent-tools';
import { gatewayModelWindows } from '../../../gatewayModels';
import { StreamInterruptedError } from '../../../streamChatCompletion';
import { bulk, call, calls, completion, decide, fails, reply, PINNED } from '../script';
import type { Scenario, ScenarioHost } from '../types';

const FLASH = 'direct/minimax/MiniMax-M3.1-Flash-Preview';
const SMALL = 'direct/cloudflare/@cf/meta/llama-3.3-70b';
const READ = { read_file: (a: unknown) => ({ ok: true, path: (a as { path?: string }).path, content: 'export const a = 1;\n', totalLines: 1 }) };
const IDE = {
  ...READ,
  edit_file: () => ({ ok: true }),
  run_command: () => ({ ok: true, output: 'ok' }),
  git_status: () => ({ ok: true }),
  git_commit: () => ({ ok: true }),
  git_push: () => ({ ok: true, action: 'push', output: 'Pushed main to origin\n## main...origin/main' }),
  builtin_chats_list_tickets: () => [{ kind: 'task', ref: '2466', status: 'in_review', exists: true }],
  builtin_tasks_update: () => ({ ok: true }),
};

const childReport = (h: ScenarioHost): void =>
  queueRunSteering(h.key, childReportText({ handle: 'a1', name: 'Ada', state: 'done', label: 'locate auth', changedFiles: ['src/auth.ts'] } as never));

export const smallWindowWithTools: Scenario = {
  id: 'small-window-tools', rows: ['T2'], loopShows: ['llm.handoff'], title: 'a run on a small cloud model packs its transcript for that model while it makes tool calls',
  async run(h) {
    h.tools(READ);
    h.script([calls([call('read_file', { path: 'a.ts' }, 'c1')]), calls([call('read_file', { path: 'b.ts' }, 'c2')]), reply('Wired.')]);
    const history = Array.from({ length: 6 }, (_, i) => [
      { role: 'user' as const, content: `Earlier ${i}. ${bulk(`u${i}`, 600)}` },
      { role: 'assistant' as const, content: `Answer ${i}. ${bulk(`a${i}`, 600)}` },
    ]).flat();
    h.preload(history);
    const { seed, seedIds } = h.seedOf();
    await h.start({
      model: SMALL, modelStrict: true, maxTokens: 512, seed, seedIds,
      windowSources: { cloud: gatewayModelWindows({ byo: { models: [{ id: SMALL, contextWindow: 4_096 }] } }) },
      userTurn: 'Now wire the chip row.',
    });
  },
};

export const flashPinned: Scenario = {
  id: 'flash-pinned', rows: ['T12'], title: 'a Flash model the person pinned serves every turn of a tool run, priced on its tier',
  async run(h) {
    h.tools(READ);
    h.script([calls([call('read_file', { path: 'a.ts' }, 'c1')], { resolvedModel: FLASH, usage: { prompt: 9_000, completion: 500 } }), reply('Read it.', { resolvedModel: FLASH, usage: { prompt: 9_500, completion: 200 } })]);
    await h.start({ model: FLASH, modelStrict: true, maxRunBudgetUsd: 5, userTurn: 'read a.ts' });
  },
};

export const quickOnFlash: Scenario = {
  id: 'quick-on-flash', rows: ['T12'], loopShows: ['run.pipeline_route'], title: 'the QUICK route on a Flash quick model: it codes there with no plan phase and no verify stage',
  async run(h) {
    h.tools({ ...READ, edit_file: () => ({ ok: true }) });
    h.script([
      calls([call('edit_file', { path: 'a.ts', old: 'a', new: 'b' }, 'e1')], { resolvedModel: FLASH }),
      reply('Renamed a to b.', { resolvedModel: FLASH }),
    ]);
    await h.start({ pipeline: { routing: 'auto', threshold: 2, quickModel: FLASH }, userTurn: 'rename a to b in a.ts' });
  },
};

export const childReportAndShipGate: Scenario = {
  id: 'child-report-ship-gate', rows: ['R2', 'R11'], loopShows: ['steer.applied'], title: 'a child\'s report arrives with the final answer of a run that edited and did not ship: the report and the ship gate both get their turn',
  async run(h) {
    h.tools(IDE);
    h.script([
      calls([call('edit_file', { path: 'src/a.ts', old_string: 'x', new_string: 'y' }, 'e1')]),
      () => { childReport(h); return completion({ text: 'I fixed the deep link in src/a.ts.' }); },
      reply('Ada reported; the change is still unshipped.'),
      calls([call('git_commit', { message: 'fix', paths: ['src/a.ts'], allowBaseBranch: true }, 'g1')]),
      calls([call('git_push', { allowBaseBranch: true }, 'g2')]),
      reply('Shipped to main.'),
    ]);
    await h.start({ ...PINNED, projectId: 11, userTurn: 'fix the deep link' });
  },
};

export const childReportAndExhaustedStall: Scenario = {
  id: 'child-report-exhausted-stall', rows: ['R2', 'R3', 'R11'], loopShows: ['loop.stall_unrecovered'], title: 'a child\'s report lands on the last announcing turn of a stall that then exhausts',
  async run(h) {
    h.tools(READ);
    let n = 0;
    h.react(() => { n += 1; if (n === 4) childReport(h); return completion({ text: 'I will read the file now.' }); });
    await h.start({ userTurn: 'What does a.ts export?' });
  },
};

export const transportFailureOnReask: Scenario = {
  id: 'reask-transport-failure', rows: ['T8', 'T9'], loopShows: ['llm.role_handoff'], title: 'the coder re-ask fails in transport: the loop does not retry a re-ask, the run ends on that error, and the discarded planner turn leaves nothing behind',
  async run(h) {
    h.tools({ ...READ, edit_file: () => ({ ok: true }) });
    h.script([
      calls([call('edit_file', { path: 'a.ts', old: 'a', new: 'b' }, 'e1')], { text: 'I will edit a.ts.', resolvedModel: 'direct/qwen/qwen3.8-max' }),
      fails(new StreamInterruptedError('the model failed mid-answer: overloaded', 'claude-opus-5')),
      calls([call('edit_file', { path: 'a.ts', old: 'a', new: 'b' }, 'e2')], { text: 'Editing a.ts.', resolvedModel: 'claude-opus-5' }),
      reply('Edited a.ts.', { resolvedModel: 'claude-opus-5' }),
    ]);
    await h.start({ userTurn: 'fix a.ts' });
  },
};

export const sixFailuresInOneTurn: Scenario = {
  id: 'six-failures-one-turn', rows: ['T9'], title: 'one turn with six failing calls trips the failure breaker at once; the tools-free answer names them',
  async run(h) {
    h.tools({ read_file: () => ({ ok: false, error: 'EACCES: permission denied' }) });
    h.react(decide(({ opts }) => (opts.tools === undefined
      ? completion({ text: 'Every read failed with EACCES.' })
      : completion({ toolCalls: Array.from({ length: 6 }, (_, i) => call('read_file', { path: `f${i}.ts` }, `c${i}`)), finishReason: 'tool_calls' }))));
    await h.start({ userTurn: 'read everything' });
  },
};

export const waitInterrupted: Scenario = {
  id: 'wait-interrupted', rows: ['T11'], loopShows: ['steer.applied'], title: 'a long command wait is interrupted by a person\'s steer: the call ends, the steer is applied once',
  async run(h) {
    let waiting = false;
    h.tools({
      run_command: (_a, signal) => new Promise((resolve) => {
        waiting = true;
        signal?.addEventListener('abort', () => resolve({ ok: false, error: 'interrupted by the person\'s message' }));
      }),
    });
    h.script([calls([call('run_command', { command: 'sleep 600' }, 'r1')]), reply('Stopped waiting, as asked.')]);
    const run = h.begin({ userTurn: 'run the long build' });
    await h.until(() => waiting, 'the command is waiting');
    queueRunSteering(h.key, 'skip the build, just summarise', { interrupt: true, fromPerson: true, persist: true });
    await run;
  },
};

export const steerBeforeCommand: Scenario = {
  id: 'steer-before-command', rows: ['T11'], loopShows: ['steer.applied'], title: 'a steer queued while the model writes a run_command call arrives before the command is dispatched',
  async run(h) {
    h.tools({ run_command: () => ({ ok: true, output: 'built' }) });
    h.script([
      () => { queueRunSteering(h.key, 'do not run anything, just explain', { interrupt: true, fromPerson: true, persist: true }); return completion({ toolCalls: [call('run_command', { command: 'pnpm build' }, 'r1')], finishReason: 'tool_calls' }); },
      reply('Here is the explanation without running anything.'),
    ]);
    await h.start({ userTurn: 'build it' });
  },
};

export const reasoningMentionsNextAction: Scenario = {
  id: 'reasoning-next-action', rows: ['T4', 'R5'], title: 'a short final reply whose reasoning says what to do next is an answer, not an announced call',
  async run(h) {
    h.tools(READ);
    h.script([reply('<think>Next I should run the tests and then read the file again now.</think>Fixed.')]);
    await h.start({ userTurn: 'fix the typo' });
  },
};

export const imageWithContext: Scenario = {
  id: 'image-with-context', rows: ['T5'], title: 'an image attachment with a host context pack: the pack arrives once and the picture reaches the model as a vision part',
  async run(h) {
    h.tools(READ);
    h.script([calls([call('read_file', { path: 'docs/a.md' }, 'c1')]), reply('The screenshot matches docs/a.md.')]);
    await h.start({
      turnContext: async () => '### Focus file `docs/a.md` (2 lines, whole file)\none\ntwo',
      servedReads: async () => [{ path: 'docs/a.md', content: 'one\ntwo', totalLines: 2 }],
      userTurn: [{ type: 'text', text: 'Does this match the doc?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }],
    });
  },
};

export const twoSteersAtTurnEnd: Scenario = {
  id: 'two-steers-turn-end', rows: ['T11', 'R2'], loopShows: ['steer.applied'], title: 'two steers arrive with the final answer: both are read, in order, and the answer survives',
  async run(h) {
    h.tools(READ);
    h.script([
      () => {
        queueRunSteering(h.key, 'also cover the edge case', { fromPerson: true, persist: true });
        queueRunSteering(h.key, 'and update the docs', { fromPerson: true, persist: true });
        return completion({ text: 'All done, the port is complete.' });
      },
      reply('Edge case covered and docs updated.'),
    ]);
    await h.start({ userTurn: 'do it' });
  },
};

export const stopDuringHandOff: Scenario = {
  id: 'stop-during-hand-off', rows: ['R11'], loopShows: ['loop.hand_off_due'], title: 'a Stop pressed while the hand_off\'s ticket call is running ends the run cleanly',
  async run(h) {
    let filing = false;
    h.tools({
      ...READ,
      edit_file: () => ({ ok: true }),
      spawn_agents: () => ({ ok: true }),
      builtin_tasks_create: (_a, signal) => new Promise((resolve) => {
        filing = true;
        signal?.addEventListener('abort', () => resolve({ ok: false, error: 'stopped' }));
        setTimeout(() => resolve({ id: 901 }), 5_000);
      }),
    });
    let reads = 0;
    h.react(decide(({ opts }) => {
      const names = (opts.tools ?? []).map((t) => t.function.name);
      if (names.length === 1 && names[0] === 'hand_off') {
        return completion({ toolCalls: [call('hand_off', { summary: 'a.ts is simple', tasks: [{ title: 'Edit a', brief: 'Edit a.ts', paths: ['a.ts'] }] }, 'h1')], finishReason: 'tool_calls' });
      }
      reads += 1;
      return completion({ toolCalls: [call('read_file', { path: `f${reads}.ts` }, `r${reads}`)], finishReason: 'tool_calls' });
    }));
    const run = h.begin({ projectId: 11, userTurn: 'remove the title from the top of the VSIX' });
    await h.until(() => filing, 'the ticket call is running');
    stopRun(h.key);
    await run;
  },
};

export const reviewScenarios: Scenario[] = [
  smallWindowWithTools, flashPinned, quickOnFlash, childReportAndShipGate, childReportAndExhaustedStall, transportFailureOnReask,
  sixFailuresInOneTurn, waitInterrupted, steerBeforeCommand, reasoningMentionsNextAction, imageWithContext, twoSteersAtTurnEnd, stopDuringHandOff,
];
