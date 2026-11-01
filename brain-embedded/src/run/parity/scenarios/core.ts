/**
 * The highest-traffic Brain runs: a plain chat turn, chat mode (R1), the composer's Effort levels (T1), the QUICK
 * route (T12), a tool run and the three gateway refusals (T3). Each is scripted once and run on both engines.
 */

import { brainRequestError } from '../../../chatError';
import { effortProfile, reasoningForRun } from '../../../effort';
import { calls, call, fails, reply } from '../script';
import type { Scenario } from '../types';

const READ = { read_file: () => ({ ok: true, content: 'export const a = 1;\n' }), list_files: () => ({ ok: true, files: ['a.ts', 'b.ts'] }) };

export const plainChat: Scenario = {
  id: 'plain-chat', rows: ['T14'], title: 'a plain chat turn that answers in prose',
  async run(h) {
    h.script([reply('Hello! Done.')]);
    await h.start();
  },
};

export const chatModeKeepsTools: Scenario = {
  id: 'chat-mode-tools', rows: ['R1'], title: 'chat mode offers the full tool catalog and runs a tool; only the directive changes',
  async run(h) {
    h.tools(READ);
    h.script([calls([call('read_file', { path: 'a.ts' }, 'c1')], { text: 'Let me look.' }), reply('It exports a.')]);
    await h.start({ chatMode: 'chat', userTurn: 'What does a.ts export?' });
  },
};

export const workModeTool: Scenario = {
  id: 'work-mode-tools', rows: ['R1', 'T14'], title: 'work mode runs a tool turn then answers',
  async run(h) {
    h.tools(READ);
    h.script([calls([call('list_files', {}, 'c1')]), calls([call('read_file', { path: 'a.ts' }, 'c2')]), reply('Done: a.ts exports a.')]);
    await h.start({ chatMode: 'work', userTurn: 'Look at the repo.' });
  },
};

const effortScenario = (effort: 'quick' | 'balanced' | 'thorough', thinking: boolean): Scenario => ({
  id: `effort-${effort}${thinking ? '-thinking' : ''}`, rows: ['T1'], title: `Effort ${effort}${thinking ? ' with Thinking' : ''}: max_tokens and reasoning reach the wire on every turn`,
  async run(h) {
    h.tools(READ);
    const reasoning = reasoningForRun({ effort, thinking });
    h.script([calls([call('read_file', { path: 'a.ts' }, 'c1')]), reply('All good.')]);
    await h.start({ maxTokens: effortProfile(effort).maxTokens, ...(reasoning ? { reasoning } : {}), userTurn: 'Check a.ts.' });
  },
});
export const effortQuick = effortScenario('quick', false);
export const effortBalancedThinking = effortScenario('balanced', true);
export const effortThorough = effortScenario('thorough', true);

export const quickRoute: Scenario = {
  id: 'quick-route', rows: ['T12'], title: 'QUICK route with a non-strict model: the quick model serves the run',
  async run(h) {
    h.tools(READ);
    h.script([calls([call('read_file', { path: 'a.ts' }, 'c1')]), reply('Renamed.')]);
    await h.start({ pipeline: { routing: 'auto', threshold: 2, quickModel: 'quick/model-q' }, model: 'soft/default', userTurn: 'rename foo to bar in a.ts' });
  },
};

export const thoroughRoute: Scenario = {
  id: 'thorough-route', rows: ['T12'], title: 'the full pipeline route (plan, code, verify) on a routed host',
  async run(h) {
    h.tools(READ);
    h.script([calls([call('read_file', { path: 'a.ts' }, 'c1')]), reply('Planned and done.')]);
    await h.start({ pipeline: { routing: 'always', quickModel: 'quick/model-q' }, userTurn: 'Refactor the whole auth module.' });
  },
};

const refusal = (status: number, body: Record<string, unknown>): Scenario => ({
  id: `refusal-${status}`, rows: ['T3'], title: `the gateway answers ${status}: the original error reaches errorAction with no prefix`,
  async run(h) {
    h.script([fails(brainRequestError(status, body)), reply('Recovered.')]);
    await h.start();
  },
});
export const refusal401 = refusal(401, { error: 'session expired', code: 'unauthorized' });
export const refusal402 = refusal(402, { error: 'needs a validated card', code: 'card_required' });
export const refusal402Plan = refusal(402, { error: 'upgrade your plan', code: 'plan_required', requiredPlan: 'pro', feature: 'long_runs' });
export const refusal429 = refusal(429, { error: 'rate limited' });

export const coreScenarios: Scenario[] = [
  plainChat, chatModeKeepsTools, workModeTool, effortQuick, effortBalancedThinking, effortThorough,
  quickRoute, thoroughRoute, refusal401, refusal402, refusal402Plan, refusal429,
];
