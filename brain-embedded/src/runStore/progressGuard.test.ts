import { beforeEach, describe, expect, it } from 'vitest';
import { isCoderReask } from '@builderforce/run-policy';
import { getRunTrace, resetBrainRunStore, startRun } from '../brainRunStore';
import { RunProgressGuard } from './progressGuard';

// PRD 35 WS8p: VS Code chat #6 said "Now I have everything I need" and read one more new
// file, turn after turn (run #562: 105 turns, ⚠ SPUN). The cache breaker never saw it (new
// ground), A3 would not have either (a new file is progress), and A3 was not bound here.

beforeEach(resetBrainRunStore);

type Sent = { role: string; content: string; metadata?: string };
const persistence = () => ({
  sendMessages: async (chatId: number, msgs: Sent[]) => msgs.map((m, i) => ({ id: 9200 + i, chatId, createdAt: '', ...m })),
}) as never;

const TOOLS = ['read_file', 'edit_file', 'write_file', 'spawn_agent'].map((name) => ({
  type: 'function' as const,
  function: { name, description: name, parameters: {} },
}));
type Call = { id: string; name: string; args: string };
type Step = { text: string; call: Call } | null;
const READY = 'Now I have everything I need.';
const read = (i: number): Call => ({ id: `r${i}`, name: 'read_file', args: JSON.stringify({ path: `docs/file-${i}.md` }) });
const edit = (i: number): Call => ({ id: `e${i}`, name: 'edit_file', args: JSON.stringify({ path: `src/f${i}.ts`, old_string: 'a', new_string: 'b' }) });
const claimAndRead = (i: number): Step => ({ text: READY, call: read(i) });
const spawn = (i: number): Call => ({ id: `s${i}`, name: 'spawn_agent', args: JSON.stringify({ task: `research ${i}` }) });

interface Request { tools: string[]; text: string }

/** Runs a scripted model; returns what each model request offered and carried. */
async function scripted(runKey: number, userTurn: string, script: Step[], child = false) {
  const requests: Request[] = [];
  let turn = 0;
  let lastRole: string | undefined;
  await startRun(runKey, {
    resolvedSystemPrompt: 'sys',
    tools: TOOLS,
    runTool: async (name, args) => (name === 'read_file'
      ? { path: (args as { path?: string }).path, content: 'line one\nline two', totalLines: 2 }
      : { ok: true }),
    stream: async (opts) => {
      const reask = isCoderReask(opts.role, lastRole);
      lastRole = opts.role;
      if (reask) turn -= 1;
      requests[turn] = {
        tools: (opts.tools ?? []).map((t) => t.function.name),
        text: opts.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n'),
      };
      const step = script[turn];
      turn += 1;
      if (step) return { text: step.text, toolCalls: [step.call], finishReason: 'tool_calls' };
      return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
    },
    persistence: persistence(),
    userTurn,
    ...(child ? { lineage: { rootChatId: 4800, ownerKey: 4800, ownerName: 'BuilderForce', handle: 'a1', label: 'WS8p', agent: { ref: 'subagent:WS8p', name: 'WS8p' }, depth: 1 } } : {}),
  });
  return { requests, trace: getRunTrace(runKey) };
}

const checks = (trace: ReturnType<typeof getRunTrace>) => trace.filter((e) => e.label === 'loop.progress_check');

describe('the readiness loop (WS8p)', () => {
  it('the guards that existed before WS8p stay quiet on it; only the unkept claim fires', async () => {
    const { trace } = await scripted(4801, 'update the PRD with the WS8p design', [0, 1, 2, 3].map(claimAndRead));
    expect(trace.some((e) => e.label === 'loop.no_progress')).toBe(false);
    expect(trace.some((e) => e.label === 'loop.change_due')).toBe(false);
    expect(checks(trace).map((e) => (e.args as { signal: string }).signal)).toEqual(['unkept_ready', 'unkept_ready']);
  });

  it('steers on the second unkept claim, then forces the change on the fourth', async () => {
    const { requests, trace } = await scripted(4802, 'update the PRD with the WS8p design', [...[0, 1, 2, 3].map(claimAndRead), { text: 'Writing it.', call: edit(4) }]);
    expect(checks(trace).map((e) => (e.args as { action: string }).action)).toEqual(['steer', 'escalate']);
    // The steer opens the turn after the second claim.
    expect(requests[2]!.text).toContain('you have said 2 times that you have what you need');
    // The escalation's turn offers no read: hand_off while planning, the change tools once coding.
    const forced = requests[4]!.tools;
    expect(forced).not.toContain('read_file');
    expect(forced.length).toBeGreaterThan(0);
    expect(trace.filter((e) => e.label === 'loop.progress_forced')).toHaveLength(1);
  });

  it('a review that reads thirty new files and claims nothing is never checked', async () => {
    const script: Step[] = Array.from({ length: 30 }, (_, i) => ({ text: '', call: read(i) }));
    const { trace } = await scripted(4803, 'review the PRD and list its gaps', script);
    expect(checks(trace)).toHaveLength(0);
  });

  it('a claim the next call keeps clears the count', async () => {
    const script: Step[] = [0, 1, 2, 3, 4, 5].map((i) => ({ text: READY, call: i % 2 ? edit(i) : read(i) }));
    const { trace } = await scripted(4804, 'update the PRD with the WS8p design', script);
    expect(checks(trace)).toHaveLength(0);
  });

  it('a sub-agent runs the same check as its owner', async () => {
    for (const [key, child] of [[-4805, true], [4806, false]] as const) {
      const { trace } = await scripted(key, 'update the PRD with the WS8p design', [0, 1].map(claimAndRead), child);
      expect(checks(trace).map((e) => (e.args as { signal: string }).signal)).toEqual(['unkept_ready']);
    }
  });

  it('a claim kept by a spawn clears the count', async () => {
    const script: Step[] = [0, 1, 2, 3, 4, 5].map((i) => ({ text: READY, call: i % 2 ? spawn(i) : read(i) }));
    const { trace } = await scripted(4807, 'update the PRD with the WS8p design', script);
    expect(checks(trace)).toHaveLength(0);
  });

  it('the third trip asks the person, with ask_user alone on the menu', async () => {
    const { requests, trace } = await scripted(4808, 'update the PRD with the WS8p design', Array.from({ length: 6 }, (_, i) => claimAndRead(i)));
    expect(checks(trace).map((e) => (e.args as { action: string }).action)).toEqual(['steer', 'escalate', 'pause']);
    const asked = requests.find((r) => r?.tools.length === 1 && r.tools[0] === 'ask_user');
    expect(asked?.text).toContain('Continue with guidance');
  });
});

describe('RunProgressGuard', () => {
  const readOnlyTurn = (g: RunProgressGuard, i: number) => {
    g.noteTurnText(READY);
    g.observe('read_file', { path: `f${i}.md` }, { data: { ok: true } });
    return g.endTurn();
  };

  it('keeps an escalation due until a turn takes it, whatever the turns in between', () => {
    const g = new RunProgressGuard(true);
    for (let i = 0; i < 4; i++) readOnlyTurn(g, i);
    // A budget forced the next turn, so nothing took the escalation; a quiet turn follows.
    g.noteTurnText('');
    g.observe('edit_file', { path: 'src/a.ts', old_string: 'a', new_string: 'b' }, { data: { ok: true } });
    expect(g.endTurn()).toBeNull();
    expect(g.takeDue()).toMatchObject({ kind: 'escalate', signal: { kind: 'unkept_ready' } });
    expect(g.takeDue()).toBeNull();
  });

  it("never shows the detector's 'stronger model' note: the editor forces a turn instead", () => {
    const g = new RunProgressGuard(true);
    for (let i = 0; i < 4; i++) readOnlyTurn(g, i);
    expect(g.steerNote()).not.toContain('stronger model');
  });

  it('is inert with the lever off', () => {
    const g = new RunProgressGuard(false);
    for (let i = 0; i < 8; i++) expect(readOnlyTurn(g, i)).toBeNull();
    expect(g.steerNote()).toBe('');
    expect(g.takeDue()).toBeNull();
  });
});
