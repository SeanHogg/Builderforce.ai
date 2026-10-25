import { beforeEach, describe, expect, it } from 'vitest';
import { isCoderReask } from '@builderforce/run-policy';
import { getRunTrace, resetBrainRunStore, startRun } from '../brainRunStore';
import { leftDelegationUndone } from '../delegationRequest';

// VS Code chat #6: every PRD 35 workstream brief names the sub-agent POLICY, so each
// child read its brief as "the user asked for sub-agents", was told to stop reading and
// delegate, and spent the night spawning researchers instead of writing the code.

beforeEach(resetBrainRunStore);

type Sent = { role: string; content: string; metadata?: string };
const persistence = () => ({
  sendMessages: async (chatId: number, msgs: Sent[]) => msgs.map((m, i) => ({ id: 9100 + i, chatId, createdAt: '', ...m })),
}) as never;

const TOOLS = ['read_file', 'spawn_agent', 'spawn_agents'].map((name) => ({
  type: 'function' as const,
  function: { name, description: name, parameters: {} },
}));
type Call = { id: string; name: string; args: string } | null;
const read = (i: number): Call => ({ id: `r${i}`, name: 'read_file', args: JSON.stringify({ path: `docs/file-${i}.md` }) });
const BRIEF = 'You are implementing WS1. Port the steering, ask and sub-agents policy module; children run as parallel agents.';
const lineage = { rootChatId: 4700, ownerKey: 4700, ownerName: 'BuilderForce', handle: 'a1', label: 'WS1', agent: { ref: 'subagent:WS1', name: 'WS1' }, depth: 1 };

async function scriptedChild(runKey: number, script: Call[]) {
  let turn = 0;
  let lastRole: string | undefined;
  await startRun(runKey, {
    resolvedSystemPrompt: 'sys',
    tools: TOOLS,
    runTool: async (name, args) => (name === 'read_file' ? { path: (args as { path?: string }).path, content: 'line', totalLines: 1 } : { ok: true }),
    stream: async (opts) => {
      const reask = isCoderReask(opts.role, lastRole);
      lastRole = opts.role;
      if (reask) turn -= 1;
      const call = script[turn];
      turn += 1;
      if (call) return { text: '', toolCalls: [call], finishReason: 'tool_calls' };
      return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
    },
    persistence: persistence(),
    userTurn: BRIEF,
    lineage,
  });
}

describe('a sub-agent is never told it must delegate', () => {
  it('the gate is quiet for a delegated run whatever its brief says', () => {
    const input = { toolNames: ['spawn_agents'], requestText: BRIEF, events: [] };
    expect(leftDelegationUndone(input)).toBe(true);
    expect(leftDelegationUndone({ ...input, delegatedRun: true })).toBe(false);
  });

  it('a child that reads past the threshold and finishes is neither nudged nor sent back', async () => {
    await scriptedChild(-4701, [...[1, 2, 3, 4, 5, 6, 7].map(read), null]);
    const trace = getRunTrace(-4701);
    expect(trace.some((e) => e.label === 'loop.nudge_undelegated_request')).toBe(false);
    expect(trace.some((e) => e.label === 'loop.recover_undelegated_request')).toBe(false);
  });
});
