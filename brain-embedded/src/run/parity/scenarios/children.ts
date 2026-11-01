/**
 * R11: sub-agents, children, ownership. A child is a run with an owner: its own key (cell, transcript, Stop) while
 * everything it persists lands in the owner's chat, attributed to it. The model script is ONE sequence across owner and
 * child, so a spawn runs its child to the end inside the tool call (a foreground spawn) and the order is deterministic.
 */

import { childReportText } from '@builderforce/agent-tools';
import { queueRunSteering } from '../../../runSteering';
import type { RunLineage } from '../../../runLineage';
import { calls, call, completion, reply } from '../script';
import type { Scenario, ScenarioHost } from '../types';

const CHILD_KEY = -9001;
const lineage = (h: ScenarioHost, handle = 'a1', label = 'locate auth'): RunLineage => ({
  rootChatId: h.key, ownerKey: h.key, ownerName: 'BuilderForce', handle, label, agent: { ref: 'agent_ada', name: 'Ada' }, depth: 1,
});

/** The host's `spawn_agent`: runs the child to its end and answers with its report, as a foreground spawn does. */
const spawn = (h: ScenarioHost, task: string) => async (): Promise<unknown> => {
  await h.start({ userTurn: task, lineage: lineage(h) }, CHILD_KEY);
  return { ok: true, handle: 'a1', state: 'done' };
};

export const subAgentSpawn: Scenario = {
  id: 'sub-agent-spawn', rows: ['R11'], title: 'the owner spawns a child; the child\'s rows land in the owner chat attributed to it, and the owner reads the report',
  async run(h) {
    h.tools({ read_file: () => ({ ok: true, content: 'x' }), spawn_agent: spawn(h, 'where is the auth middleware?') });
    h.script([
      calls([call('spawn_agent', { label: 'locate auth', task: 'where is the auth middleware?' }, 's1')], { text: 'Delegating.' }),
      reply('Found it in src/auth.ts:12.'),
      reply('The auth middleware is in src/auth.ts:12, as the sub-agent found.'),
    ]);
    await h.start({ userTurn: 'find the auth middleware using a sub-agent' });
  },
};

export const childReportAtTurnEnd: Scenario = {
  id: 'child-report-turn-end', rows: ['R11', 'R2'], title: 'a background child\'s report arrives while the owner writes its last prose turn: the turn keeps its text and the owner wakes on the report',
  async run(h) {
    h.tools({ read_file: () => ({ ok: true, content: 'x' }) });
    h.script([
      () => {
        queueRunSteering(h.key, childReportText({ handle: 'a1', name: 'Ada', state: 'done', label: 'locate auth', changedFiles: ['src/auth.ts'] } as never));
        return completion({ text: 'I handed the search to Ada and will summarise when she reports.' });
      },
      reply('Ada found the middleware in src/auth.ts.'),
    ]);
    await h.start({ userTurn: 'find the auth middleware' });
  },
};

export const steerAChild: Scenario = {
  id: 'steer-a-child', rows: ['R11', 'T11'], title: 'a person steers a running child through its own key; the child applies it once on its next turn',
  async run(h) {
    h.tools({
      read_file: () => ({ ok: true, content: 'x' }),
      spawn_agent: spawn(h, 'check the login flow'),
    });
    h.script([
      calls([call('spawn_agent', { label: 'locate auth', task: 'check the login flow' }, 's1')]),
      () => { queueRunSteering(CHILD_KEY, 'also check the logout flow', { interrupt: true, fromPerson: true, persist: true }); return completion({ text: 'The login flow is fine.' }); },
      reply('Logout flow checked too.'),
      reply('Both flows are fine.'),
    ]);
    await h.start({ userTurn: 'check the auth flows using a sub-agent' });
  },
};

export const childOwnsItsTranscript: Scenario = {
  id: 'child-own-transcript', rows: ['R11'], title: 'a child started on its own key leaves the owner\'s transcript alone and keeps its own',
  async run(h) {
    h.script([reply('Delegating.'), reply('Found it in src/auth.ts:12.')]);
    await h.start({ userTurn: 'find it' });
    await h.start({ userTurn: 'where is the auth middleware?', lineage: lineage(h) }, CHILD_KEY);
  },
};

export const childScenarios: Scenario[] = [subAgentSpawn, childReportAtTurnEnd, steerAChild, childOwnsItsTranscript];
