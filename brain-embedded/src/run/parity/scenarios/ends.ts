/**
 * How a run ends or is sent back (R2 to R5, T3, T9): Stop during a stream, the stall ladder to failover and to
 * exhaustion, the gates that re-prompt a final answer (ship, stop hook, handed-off commands, restated reply, undelegated
 * request), and a model that breaks mid-answer.
 */

import { stopRun } from '../../../runStore/runControl';
import { StreamInterruptedError } from '../../../streamChatCompletion';
import { calls, call, completion, decide, fails, reply, streamsUntilStopped } from '../script';
import type { Scenario } from '../types';

const IDE = {
  edit_file: () => ({ ok: true }),
  run_command: () => ({ ok: true, output: 'ok' }),
  git_status: () => ({ ok: true }),
  git_diff: () => ({ ok: true }),
  git_commit: () => ({ ok: true }),
  git_push: () => ({ ok: true, action: 'push', output: 'Pushed main to origin\n## main...origin/main' }),
  builtin_chats_list_tickets: () => [{ kind: 'task', ref: '2466', status: 'in_review', exists: true }],
  builtin_tasks_update: () => ({ ok: true }),
};
const READ = { read_file: () => ({ ok: true, content: 'export const a = 1;\n' }) };

export const stopDuringStream: Scenario = {
  id: 'stop-during-stream', rows: [], title: 'Stop while a reply streams keeps the partial reply with its model and records agent.stopped',
  async run(h) {
    let streaming = false;
    h.script([streamsUntilStopped(() => { streaming = true; }, ['Checking linked tickets. ', 'Checking linked tickets again.'], 'direct/minimax/MiniMax-M2.7')]);
    const run = h.begin({ userTurn: 'go' });
    await h.until(() => streaming, 'the reply is streaming');
    stopRun(h.key);
    await run;
  },
};

export const stopBeforeAnyText: Scenario = {
  id: 'stop-before-text', rows: [], title: 'Stop before a single token arrived persists no reply but still records the stop',
  async run(h) {
    let streaming = false;
    h.script([streamsUntilStopped(() => { streaming = true; }, [], 'xai-oauth/grok-4.6')]);
    const run = h.begin({ userTurn: 'go' });
    await h.until(() => streaming, 'the request is open');
    stopRun(h.key);
    await run;
  },
};

export const stallToFailover: Scenario = {
  id: 'stall-failover', rows: ['R3'], title: 'a model that only announces its call is re-prompted, then the run fails over to the model the host picks',
  async run(h) {
    h.tools(READ);
    h.react(decide(({ opts }) => {
      if (opts.model === 'fallback/model-b') {
        return (opts.messages.some((m) => m.role === 'tool'))
          ? completion({ text: 'The file exports a.', resolvedModel: 'fallback/model-b' })
          : completion({ toolCalls: [call('read_file', { path: 'a.ts' }, 'c1')], finishReason: 'tool_calls', resolvedModel: 'fallback/model-b' });
      }
      return completion({ text: 'I will read the file now.' });
    }));
    await h.start({ pickFallbackModel: (tried) => (tried.includes('fallback/model-b') ? undefined : 'fallback/model-b'), userTurn: 'What does a.ts export?' });
  },
};

export const stallToExhaustion: Scenario = {
  id: 'stall-exhaustion', rows: ['R3', 'R4', 'R5'], title: 'a model that never acts spends its budget; the run settles on its text with the exhaustion notice, learns nothing',
  async run(h) {
    h.tools(READ);
    h.react(() => completion({ text: 'I will read the file now.' }));
    await h.start({ userTurn: 'What does a.ts export?' });
  },
};

export const handedOffCommands: Scenario = {
  id: 'handed-off-commands', rows: ['R2', 'R4'], title: 'a turn that edits then hands the user the commands it holds the tools for is sent back, and keeps its text',
  async run(h) {
    h.tools(IDE);
    h.script([calls([call('edit_file', { path: 'boardRoutes.ts', find: 'a', replace: 'b' }, 'e1')])]);
    h.react(() => completion({ text: 'I applied the fix to boardRoutes.ts.\n\nNext steps:\n1. Run `pnpm --filter builderforce-api type-check`\n2. Commit and push the change\n' }));
    await h.start({ userTurn: 'Fix the type errors' });
  },
};

export const shipGate: Scenario = {
  id: 'ship-gate', rows: ['R2', 'R4'], title: 'a run that edited and stopped is sent back to ship; the verified push closes the ticket',
  async run(h) {
    h.tools(IDE);
    h.script([
      calls([call('edit_file', { path: 'src/a.ts', old_string: 'x', new_string: 'y' }, 'e1')]),
      reply('I fixed the deep link in src/a.ts.'),
      calls([call('git_commit', { message: 'fix deep link', paths: ['src/a.ts'], allowBaseBranch: true }, 'g1')]),
      calls([call('git_push', { allowBaseBranch: true }, 'g2')]),
      reply('Shipped as abc123 - pushed to main.'),
    ]);
    await h.start({ projectId: 11, userTurn: 'fix the deep link' });
  },
};

export const stopHook: Scenario = {
  id: 'stop-hook', rows: ['R2', 'R4'], title: 'the host\'s stop hook holds a run that is about to end and hands it one more instruction',
  async run(h) {
    h.tools(READ);
    h.script([reply('Done reading a.ts.'), reply('README updated as well.')]);
    await h.start({ onStop: async ({ round }) => (round === 0 ? 'Update the README with what you did.' : null), userTurn: 'Look at a.ts.' });
  },
};

const STATUS = 'Status: the migration is not complete. The tickets are still in review, the branch has not been merged, the roadmap has two open gaps in the delivery lane, and the ledger shows the same three blockers as before. Nothing else changed since the last report.';

export const restatedReply: Scenario = {
  id: 'restated-reply', rows: ['R2', 'R4'], title: 'a final reply that restates the previous turn\'s answer is sent back once',
  async run(h) {
    h.tools(READ);
    h.script([reply(STATUS), reply(STATUS), reply('New progress: I merged the branch and closed the two open gaps.')]);
    await h.start({ userTurn: 'What is the status?' });
    await h.start({ userTurn: 'And now?' });
  },
};

export const undelegatedRequest: Scenario = {
  id: 'undelegated-request', rows: ['R2', 'R4'], title: 'an explicit sub-agent request that is answered in prose is sent back once, and the next turn spawns',
  async run(h) {
    h.tools({ read_file: () => ({ ok: true }), spawn_agent: () => ({ ok: true }), spawn_agents: () => ({ ok: true }) });
    h.script([
      reply('Agent execution is disabled in this workspace and there are no developer agents.'),
      calls([call('spawn_agents', { workstreams: [{ label: 'S2', task: 'do S2', ticket: '2861' }] }, 's1')]),
      reply('S2 delivered by a sub-agent.'),
    ]);
    await h.start({ userTurn: 'complete the remaining tickets using subagents' });
  },
};

export const midAnswerBreak: Scenario = {
  id: 'model-breaks-mid-answer', rows: ['T9'], title: 'a model that breaks mid-answer is retried once on another connected model, and left out of every later turn',
  async run(h) {
    h.tools(READ);
    h.script([
      fails(new StreamInterruptedError('the model got stuck repeating itself', 'xai-oauth/grok-4.6')),
      calls([call('read_file', { path: 'a.ts' }, 'c1')]),
      reply('Here is the answer.'),
    ]);
    await h.start({ userTurn: 'explain a.ts' });
  },
};

export const pinnedModelBreaks: Scenario = {
  id: 'pinned-model-breaks', rows: ['T9'], title: 'a model the user pinned is not routed around: the run ends with the error',
  async run(h) {
    h.tools(READ);
    h.script([fails(new StreamInterruptedError('the model failed mid-answer: overloaded', 'xai-oauth/grok-4.5'))]);
    await h.start({ model: 'xai-oauth/grok-4.5', modelStrict: true, userTurn: 'explain a.ts' });
  },
};

export const toolFailureBreaker: Scenario = {
  id: 'tool-failure-breaker', rows: ['T9'], title: 'five failing calls in a row stop the loop; the forced tools-free answer names the failures',
  async run(h) {
    h.tools({ read_file: () => ({ ok: false, error: 'EACCES: permission denied' }) });
    h.react(decide(({ opts, call: n }) => (opts.tools === undefined
      ? completion({ text: 'I could not read anything: every call failed with EACCES.' })
      : completion({ toolCalls: [call('read_file', { path: `f${n}.ts` }, `c${n}`)], finishReason: 'tool_calls' }))));
    await h.start({ userTurn: 'read everything' });
  },
};

export const endScenarios: Scenario[] = [
  stopDuringStream, stopBeforeAnyText, stallToFailover, stallToExhaustion, handedOffCommands, shipGate, stopHook,
  restatedReply, undelegatedRequest, midAnswerBreak, pinnedModelBreaks, toolFailureBreaker,
];
