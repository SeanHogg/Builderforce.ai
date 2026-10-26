/**
 * END TO END: a change request goes from analysis to code that actually runs.
 *
 * Every piece below has its own unit test; this file proves the CHAIN, through the real
 * run store, with a scripted model that behaves the way MiniMax Flash did in VS Code
 * chats #6 and #5739 ("remove the title from the top of the VSIX"): it reads, and reads,
 * and never edits or hands off. The contract, link by link:
 *
 *   1. analysis ends — after `PLAN_TURN_BUDGET` reading turns the next turn offers
 *      `hand_off` ALONE and requires the call;
 *   2. the hand-off carries the work — one ticket per task, and every coding child's
 *      brief holds the user's goal, the research summary and what was already read;
 *   3. coding follows — every later turn asks the gateway for the `code` role (what makes
 *      the gateway lead with the strongest connected coder) and never re-offers hand_off;
 *   4. the edit EXECUTES — the coder's `edit_file` reaches the host's tool runner;
 *   5. the record tells the story — "Routing by role" counts the forced hand-off and
 *      names the model that served each role.
 *
 * Plus the two ways the chain must hold anyway: a planner that ignores even the forced
 * turn (planning ends, the coder takes the next turn), and a sub-agent (it starts in
 * `code`, never re-analysing). And the one way it must NOT fire: a question is answered,
 * however many reads it takes.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { PLAN_TURN_BUDGET } from '@builderforce/run-policy';
import { getRunTrace, resetBrainRunStore, startRun, type BrainStreamFn } from './brainRunStore';
import { modelTurnLog } from './modelScorecard';
import { formatRoutingByRole, routingByRole } from './routingByRole';

beforeEach(resetBrainRunStore);

const FLASH = 'direct/minimax/MiniMax-M3.1-Flash-Preview';
const GROK = 'direct/xai/grok-4.7';
const REQUEST = 'remove the title from the top of the VSIX';

const spec = (name: string) => ({ type: 'function' as const, function: { name, description: name, parameters: {} } });
const TOOLS = [spec('read_file'), spec('edit_file'), spec('builtin_tasks_create'), spec('spawn_agents')];

const PLAN = {
  summary: 'The title is rendered by SurfaceHeader via VsCodeChatHeader; the InlineChatTitle context is the chat name, not the title.',
  tasks: [
    { title: 'Drop the header title', brief: 'Stop passing the project title to SurfaceHeader in VsCodeChatHeader.tsx.', paths: ['clients/vscode/webview/src/chat/VsCodeChatHeader.tsx'] },
    { title: 'Let SurfaceHeader omit its title', brief: 'Render no title span when SurfaceHeader is given none.', paths: ['packages/brain-ui/src/surface/SurfaceHeader.tsx'] },
  ],
};

interface Turn {
  role: string;
  tools: string[];
  toolChoice: unknown;
}

interface Call {
  name: string;
  args: Record<string, unknown>;
}

/** The host: records every tool call, answers each the way the editor host would. */
function host(calls: Call[]) {
  let nextTicket = 900;
  return async (name: string, args: unknown): Promise<unknown> => {
    calls.push({ name, args: (args ?? {}) as Record<string, unknown> });
    if (name === 'read_file') return { ok: true, path: (args as { path?: string }).path, content: 'export const x = 1;' };
    if (name === 'builtin_tasks_create') return { id: (nextTicket += 1), title: (args as { title: string }).title };
    if (name === 'spawn_agents') {
      const ws = (args as { workstreams: unknown[] }).workstreams;
      return { ok: true, workstreams: ws.map(() => ({ ok: true })), changedFiles: PLAN.tasks.map((t) => t.paths[0]) };
    }
    return { ok: true };
  };
}

/**
 * The model chats #6 and #5739 met: while it is planning it reads a new file every turn
 * and never edits. `onForced` is what it does on the turn that offers `hand_off` alone.
 * Once it is coding it makes one edit and finishes.
 */
function analysisParalysis(turns: Turn[], onForced: 'hand_off' | 'keep_reading'): BrainStreamFn {
  let reads = 0;
  let edited = false;
  return async (opts) => {
    const tools = (opts.tools ?? []).map((t) => t.function.name);
    turns.push({ role: String(opts.role), tools, toolChoice: opts.tool_choice });
    const read = () => {
      reads += 1;
      return { text: '', toolCalls: [{ id: `r${reads}`, name: 'read_file', args: JSON.stringify({ path: `src/file${reads}.ts` }) }], finishReason: 'tool_calls', resolvedModel: FLASH };
    };
    if (tools.length === 1 && tools[0] === 'hand_off') {
      return onForced === 'hand_off'
        ? { text: 'The analysis is done.', toolCalls: [{ id: 'h1', name: 'hand_off', args: JSON.stringify(PLAN) }], finishReason: 'tool_calls', resolvedModel: FLASH }
        : read();
    }
    if (opts.role === 'plan') return read();
    if (opts.tools && !edited) {
      edited = true;
      return {
        text: '',
        toolCalls: [{ id: 'e1', name: 'edit_file', args: JSON.stringify({ path: PLAN.tasks[0]!.paths[0], old: 'title={', new: 'title={null} data-was={' }) }],
        finishReason: 'tool_calls',
        resolvedModel: GROK,
      };
    }
    return { text: 'Removed the title; the header now starts with the chat name.', toolCalls: [], finishReason: 'stop', resolvedModel: GROK };
  };
}

const persistence = { sendMessages: async () => [] };

describe('a change request goes from analysis to code that runs (end to end)', () => {
  it('ends analysis at the budget, hands off with the research, codes on the coding role, and the edit executes', async () => {
    const turns: Turn[] = [];
    const calls: Call[] = [];
    await startRun(6101, {
      resolvedSystemPrompt: 'sys',
      tools: TOOLS,
      projectId: 11,
      runTool: host(calls),
      stream: analysisParalysis(turns, 'hand_off'),
      persistence,
      userTurn: REQUEST,
    });
    const trace = getRunTrace(6101);

    // 1. Analysis ends: exactly the budget in reading turns, then the forced hand-off turn.
    const forcedAt = turns.findIndex((t) => t.tools.length === 1 && t.tools[0] === 'hand_off');
    expect(forcedAt).toBe(PLAN_TURN_BUDGET);
    expect(turns.slice(0, PLAN_TURN_BUDGET).every((t) => t.role === 'plan')).toBe(true);
    expect(turns[forcedAt]!.toolChoice).toBe('required');
    expect(trace.some((e) => e.label === 'loop.hand_off_due')).toBe(true);

    // 2. The hand-off carries the work: a ticket per task, and every child briefed in full.
    expect(calls.filter((c) => c.name === 'builtin_tasks_create').map((c) => c.args.title)).toEqual(PLAN.tasks.map((t) => t.title));
    const fan = calls.find((c) => c.name === 'spawn_agents');
    const workstreams = fan?.args.workstreams as Array<{ role: string; task: string }>;
    expect(workstreams.map((w) => w.role)).toEqual(['code', 'code']);
    for (const w of workstreams) {
      expect(w.task).toContain(`The goal — what the user asked for: ${REQUEST}`);
      expect(w.task).toContain('Research handed to you');
      expect(w.task).toContain(PLAN.summary);
      expect(w.task).toContain('src/file1.ts');
    }

    // 3. Coding follows: every later tool turn asks for `code`, and hand_off is never offered again.
    const after = turns.slice(forcedAt + 1).filter((t) => t.tools.length > 0);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((t) => t.role === 'code')).toBe(true);
    expect(after.some((t) => t.tools.includes('hand_off'))).toBe(false);

    // 4. The edit executes: the coder's edit_file reached the host's tool runner.
    expect(calls.some((c) => c.name === 'edit_file' && c.args.path === PLAN.tasks[0]!.paths[0])).toBe(true);

    // 5. The record tells the story.
    const routing = routingByRole(modelTurnLog(trace), trace);
    expect(routing.handOffsForced).toBe(1);
    expect(routing.handOffs).toBe(1);
    expect(routing.roles.find((r) => r.role === 'plan')?.models[0]?.model).toBe(FLASH);
    expect(routing.roles.find((r) => r.role === 'code')?.models[0]?.model).toBe(GROK);
    const lines = formatRoutingByRole(routing);
    expect(lines.some((l) => l.includes('1 hand_off call(s) · 1 forced by the analysis budget'))).toBe(true);
    expect(lines.some((l) => l.startsWith('  ⚠'))).toBe(false);
  });

  it('ends planning even when the planner ignores the forced turn, and the coder makes the edit', async () => {
    const turns: Turn[] = [];
    const calls: Call[] = [];
    await startRun(6102, {
      resolvedSystemPrompt: 'sys',
      tools: TOOLS,
      runTool: host(calls),
      stream: analysisParalysis(turns, 'keep_reading'),
      persistence,
      userTurn: REQUEST,
    });
    const trace = getRunTrace(6102);
    const forcedAt = turns.findIndex((t) => t.tools.length === 1 && t.tools[0] === 'hand_off');
    expect(forcedAt).toBe(PLAN_TURN_BUDGET);
    // The very next turn is the coder's, with the full menu and no hand_off.
    const next = turns[forcedAt + 1]!;
    expect(next.role).toBe('code');
    expect(next.tools).toContain('edit_file');
    expect(next.tools).not.toContain('hand_off');
    expect(trace.some((e) => e.label === 'loop.plan_budget_spent')).toBe(true);
    expect(calls.some((c) => c.name === 'edit_file')).toBe(true);
    // Nothing was fanned out — the run itself coded.
    expect(calls.some((c) => c.name === 'spawn_agents')).toBe(false);
  });

  it('starts a coding sub-agent in code, so it makes its change instead of re-analysing', async () => {
    const turns: Turn[] = [];
    const calls: Call[] = [];
    await startRun(77, { resolvedSystemPrompt: 'sys', stream: async () => ({ text: 'Delegating.', toolCalls: [], finishReason: 'stop' }), persistence, userTurn: REQUEST });
    await startRun(-6103, {
      resolvedSystemPrompt: 'sys',
      tools: TOOLS,
      runTool: host(calls),
      stream: analysisParalysis(turns, 'hand_off'),
      persistence,
      userTurn: `${PLAN.tasks[0]!.title}\n\n${PLAN.tasks[0]!.brief}`,
      lineage: { rootChatId: 77, ownerKey: 77, ownerName: 'BuilderForce', handle: 'a1', label: PLAN.tasks[0]!.title, agent: { ref: 'subagent:a1', name: 'Developer' }, depth: 1 },
    });
    expect(turns[0]!.role).toBe('code');
    expect(turns.some((t) => t.role === 'plan')).toBe(false);
    expect(calls.some((c) => c.name === 'edit_file')).toBe(true);
  });

  it('never forces a hand-off on a QUESTION, however many reads answering it takes', async () => {
    const turns: Turn[] = [];
    let reads = 0;
    await startRun(6104, {
      resolvedSystemPrompt: 'sys',
      tools: TOOLS,
      runTool: host([]),
      stream: async (opts) => {
        const tools = (opts.tools ?? []).map((t) => t.function.name);
        turns.push({ role: String(opts.role), tools, toolChoice: opts.tool_choice });
        if (!opts.tools || reads >= PLAN_TURN_BUDGET + 5) return { text: 'It is rendered by SurfaceHeader.', toolCalls: [], finishReason: 'stop' };
        reads += 1;
        return { text: '', toolCalls: [{ id: `r${reads}`, name: 'read_file', args: JSON.stringify({ path: `src/q${reads}.ts` }) }], finishReason: 'tool_calls' };
      },
      persistence,
      userTurn: 'how does the VSIX header decide which title to show?',
    });
    expect(turns.some((t) => t.tools.length === 1 && t.tools[0] === 'hand_off')).toBe(false);
    expect(getRunTrace(6104).some((e) => e.label === 'loop.hand_off_due' || e.label === 'loop.plan_budget_spent')).toBe(false);
  });
});
