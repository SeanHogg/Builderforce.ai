import { beforeEach, describe, expect, it } from 'vitest';
import { isCoderReask } from '@builderforce/run-policy';
import { getRunTrace, resetBrainRunStore, startRun } from '../brainRunStore';

// PRD 35 E5 / WS8c: a run asked to use sub-agents that keeps reading is told to delegate
// on the read that reaches the threshold — not only when it finally answers.

beforeEach(resetBrainRunStore);

type Sent = { role: string; content: string; metadata?: string };
const persistence = () => ({
  sendMessages: async (chatId: number, msgs: Sent[]) => msgs.map((m, i) => ({ id: 9000 + i, chatId, createdAt: '', ...m })),
}) as never;

const TOOLS = ['read_file', 'spawn_agent', 'spawn_agents'].map((name) => ({
  type: 'function' as const,
  function: { name, description: name, parameters: {} },
}));
type Call = { id: string; name: string; args: string } | null;
const read = (i: number): Call => ({ id: `r${i}`, name: 'read_file', args: JSON.stringify({ path: `docs/file-${i}.md` }) });
const SPAWN: Call = { id: 's1', name: 'spawn_agents', args: JSON.stringify({ workstreams: [{ label: 'R1', task: 'research R1' }] }) };
const NUDGE = 'STOP READING AND DELEGATE';
const LABEL = 'loop.nudge_undelegated_request';

/** Every string a tool row carries — its parsed JSON's string leaves, or the raw text. */
function textInRow(row: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row);
  } catch {
    return [row];
  }
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(parsed);
  return out;
}

/** Runs a scripted model; returns the tool results the model read, per turn. */
async function scripted(chatId: number, userTurn: string, script: Call[]) {
  const toolResultsByTurn: string[][] = [];
  let turn = 0;
  let lastRole: string | undefined;
  await startRun(chatId, {
    resolvedSystemPrompt: 'sys',
    tools: TOOLS,
    runTool: async (name, args) => (name === 'read_file' ? { path: (args as { path?: string }).path, content: 'line one\nline two', totalLines: 2 } : { ok: true }),
    stream: async (opts) => {
      // The analysis→code hand-off re-asks the SAME turn of the coder: replay that step.
      const reask = isCoderReask(opts.role, lastRole);
      lastRole = opts.role;
      if (reask) turn -= 1;
      toolResultsByTurn[turn] = opts.messages.filter((m) => m.role === 'tool').map((m) => String(m.content));
      const call = script[turn];
      turn += 1;
      if (call) return { text: '', toolCalls: [call], finishReason: 'tool_calls' };
      return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
    },
    persistence: persistence(),
    userTurn,
  });
  return toolResultsByTurn;
}

describe('the early delegation nudge', () => {
  it('rides the sixth read of a run that was asked for sub-agents', async () => {
    const turns = await scripted(4601, 'review this PRD and implement it using subagents', [...[1, 2, 3, 4, 5, 6].map(read), SPAWN, null]);
    // Turn index 6 is the model call that follows read 6; it sees six read results.
    const afterRead5 = turns[5]!;
    const afterRead6 = turns[6]!;
    expect(afterRead5.some((r) => r.includes(NUDGE))).toBe(false);
    expect(afterRead6.at(-1)).toContain(NUDGE);
    // The row is the model's JSON: read the nudge out of it, not off its escaped text.
    expect(textInRow(afterRead6.at(-1)!).find((t) => t.includes(NUDGE))).toContain('role "explore"');
    expect(getRunTrace(4601).filter((e) => e.label === LABEL)).toHaveLength(1);
    // The model spawned after the nudge, so the end-of-run backstop stays quiet.
    expect(getRunTrace(4601).some((e) => e.label === 'loop.recover_undelegated_request')).toBe(false);
  });

  it('fires once per run', async () => {
    await scripted(4602, 'do this using sub-agents', [...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(read), SPAWN, null]);
    expect(getRunTrace(4602).filter((e) => e.label === LABEL)).toHaveLength(1);
  });

  it('stays quiet when the run spawned before its sixth read', async () => {
    const turns = await scripted(4603, 'implement it using subagents', [read(1), SPAWN, ...[2, 3, 4, 5, 6, 7, 8].map(read), null]);
    expect(turns.flat().some((r) => r.includes(NUDGE))).toBe(false);
    expect(getRunTrace(4603).some((e) => e.label === LABEL)).toBe(false);
  });

  it('stays quiet when the user did not ask for sub-agents', async () => {
    const turns = await scripted(4604, 'review this PRD', [...[1, 2, 3, 4, 5, 6, 7].map(read), null]);
    expect(turns.flat().some((r) => r.includes(NUDGE))).toBe(false);
    expect(getRunTrace(4604).some((e) => e.label === LABEL)).toBe(false);
  });
});
