import { beforeEach, describe, expect, it } from 'vitest';
import { isCoderReask } from '@builderforce/run-policy';
import { getRunTrace, resetBrainRunStore, startRun } from '../brainRunStore';
import { asksForSubagents } from '../delegationRequest';

// VS Code chat #6: every PRD 35 workstream brief NAMED the sub-agent policy, the gate read
// that mention as "asked for sub-agents", and each child was told to stop reading and
// delegate. A sub-agent runs the same gate as its owner, on its own brief: a brief that
// asks for sub-agents nudges a child exactly as it would nudge the owner, and one that
// only mentions them nudges neither.

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
const MENTIONS = 'You are implementing WS1. Port the steering, ask and sub-agents policy module; children run as parallel agents.';
const ASKS = 'You are implementing WS1. Use sub-agents for the research, then write the module yourself.';
const lineage = { rootChatId: 4700, ownerKey: 4700, ownerName: 'BuilderForce', handle: 'a1', label: 'WS1', agent: { ref: 'subagent:WS1', name: 'WS1' }, depth: 1 };
const NUDGE = 'loop.nudge_undelegated_request';

async function scripted(runKey: number, userTurn: string, child: boolean, script: Call[]) {
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
    userTurn,
    ...(child ? { lineage } : {}),
  });
  return getRunTrace(runKey);
}

describe('a sub-agent runs the same delegation gate as its owner', () => {
  it('a mention of sub-agents is not a request for them; an ask is', () => {
    expect(asksForSubagents(MENTIONS)).toBe(false);
    expect(asksForSubagents('the sub-agent delegation contract applies')).toBe(false);
    expect(asksForSubagents(ASKS)).toBe(true);
    expect(asksForSubagents('delegate it to sub-agents')).toBe(true);
  });

  it('a brief that only mentions sub-agents nudges neither a child nor a top-level run', async () => {
    for (const [key, child] of [[-4701, true], [4702, false]] as const) {
      const trace = await scripted(key, MENTIONS, child, [...[1, 2, 3, 4, 5, 6, 7].map(read), null]);
      expect(trace.some((e) => e.label === NUDGE)).toBe(false);
      expect(trace.some((e) => e.label === 'loop.recover_undelegated_request')).toBe(false);
    }
  });

  it('a brief that asks for sub-agents nudges a child exactly as it nudges a top-level run', async () => {
    for (const [key, child] of [[-4703, true], [4704, false]] as const) {
      const trace = await scripted(key, ASKS, child, [...[1, 2, 3, 4, 5, 6, 7].map(read), null]);
      expect(trace.filter((e) => e.label === NUDGE)).toHaveLength(1);
    }
  });
});
