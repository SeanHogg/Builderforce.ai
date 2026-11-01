/**
 * Area R of the parity rulings: tools and how a run ends on one. ask_user terminal and malformed (R8), the confirm gate
 * (R10), read dedupe and replay, a routed tool and its pin (R6, R7), an MCP tool, malformed calls (R8), the
 * hand_off and its execution (R11), and the per-turn menu (R9).
 */

import { resolveRunConfirm } from '../../../runStore/runControl';
import { getCell } from '../../../runStore/runCells';
import { calls, call, completion, decide, reply, PINNED } from '../script';
import type { Scenario } from '../types';

const READ = { read_file: (a: unknown) => ({ ok: true, path: (a as { path?: string }).path, content: 'export const a = 1;\n', totalLines: 1 }) };

export const askUserTerminal: Scenario = {
  id: 'ask-user-terminal', rows: ['R8'], title: 'ask_user settles the run on the question as one reply carrying the card block; the host tool runner never sees it',
  async run(h) {
    h.tools({ read_file: READ.read_file });
    h.script([calls([call('ask_user', { question: 'Close them or roadmap them?', options: [{ label: 'Close' }, { label: 'Roadmap' }] }, 'q1')], { text: 'Two ways to go.' })]);
    await h.start({ userTurn: 'these tickets are stale' });
  },
};

export const askUserMalformed: Scenario = {
  id: 'ask-user-malformed', rows: ['R8'], title: 'a malformed ask_user is answered with how to retry, and the run goes on',
  async run(h) {
    h.tools(READ);
    h.script([
      calls([call('ask_user', { question: 'Which?', options: ['only one'] }, 'q1')]),
      reply('Closing them, then.'),
    ]);
    await h.start({ userTurn: 'these tickets are stale' });
  },
};

export const malformedCallArgs: Scenario = {
  id: 'malformed-call-args', rows: ['R8'], loopShows: ['read_file (unparseable arguments)'], title: 'a call whose arguments are not JSON is traced with the malformed label and the model is told how to fix it',
  async run(h) {
    h.tools(READ);
    h.script([
      calls([call('read_file', '{"path": "a.ts"', 'c1')]),
      calls([call('read_file', { path: 'a.ts' }, 'c2')]),
      reply('It exports a.'),
    ]);
    await h.start({ userTurn: 'read a.ts' });
  },
};

export const unknownTool: Scenario = {
  id: 'unknown-tool', rows: ['R9'], title: 'a call to a tool that is not on the menu fails the call, and the run goes on',
  async run(h) {
    h.tools(READ);
    h.script([calls([call('delete_everything', {}, 'c1')]), reply('I cannot do that.')]);
    await h.start({ userTurn: 'clean up' });
  },
};

export const confirmApproved: Scenario = {
  id: 'confirm-approved', rows: ['R10'], title: 'a destructive call pauses on the confirm gate; approval runs it',
  async run(h) {
    h.tools({ delete_file: () => ({ ok: true }) }, ['delete_file']);
    h.script([calls([call('delete_file', { path: 'old.ts' }, 'c1')]), reply('Deleted old.ts.')]);
    const run = h.begin({ ...PINNED, userTurn: 'delete old.ts' });
    await h.until(() => getCell(h.key).pendingConfirm !== null, 'the confirm gate is raised');
    resolveRunConfirm(h.key, true);
    await run;
  },
};

export const confirmDeclined: Scenario = {
  id: 'confirm-declined', rows: ['R10'], title: 'a declined confirm does not run the call and tells the model',
  async run(h) {
    h.tools({ delete_file: () => ({ ok: true }) }, ['delete_file']);
    h.script([calls([call('delete_file', { path: 'old.ts' }, 'c1')]), reply('Left old.ts alone.')]);
    const run = h.begin({ ...PINNED, userTurn: 'delete old.ts' });
    await h.until(() => getCell(h.key).pendingConfirm !== null, 'the confirm gate is raised');
    resolveRunConfirm(h.key, false);
    await run;
  },
};

export const readDedupe: Scenario = {
  id: 'read-dedupe', rows: ['R6'], title: 'an exact repeat of a read is answered from the run cache with a stub, and the disk is read once',
  async run(h) {
    h.tools({ ...READ, builtin_tickets_from_delta: () => ({ ok: true }) });
    h.script([
      calls([call('read_file', { path: 'a.css' }, 'c1')]),
      calls([call('builtin_tickets_from_delta', { chatId: 99 }, 'c2')]),
      calls([call('read_file', { path: 'a.css' }, 'c3')]),
      reply('Reduced the height.'),
    ]);
    await h.start({ userTurn: 'reduce the height' });
  },
};

export const bigReadPaged: Scenario = {
  id: 'big-read-paged', rows: ['R6'], title: 'a big read is paged by line and the continuation offset stays in front of the model',
  async run(h) {
    const body = Array.from({ length: 800 }, (_, i) => `line ${i + 1} ${'x'.repeat(60)}`).join('\n');
    h.tools({ read_file: () => ({ ok: true, path: 'api/src/ChatTicketService.ts', content: body, truncated: false, totalLines: 800, offset: 1 }) });
    h.script([calls([call('read_file', { path: 'api/src/ChatTicketService.ts' }, 'c1')]), reply('Read the first window.')]);
    await h.start({ userTurn: 'fix the deep link' });
  },
};

const BIG = Array.from({ length: 70 }, (_, i) => `tool_${String(i).padStart(2, '0')}`);

export const routedToolPin: Scenario = {
  id: 'routed-tool-pin', rows: ['R6', 'R7', 'R9'], loopShows: ['tools.routed', 'tool_42'], title: 'a tool reached through builtin_tools_invoke on a 70-tool catalog is pinned for later turns; the router shows while the catalog is large',
  async run(h) {
    h.tools({ ...READ, ...Object.fromEntries(BIG.map((n) => [n, () => ({ ok: true, from: n })])) });
    h.script([
      calls([call('builtin_tools_find', { query: 'tool 42' }, 'f1')]),
      calls([call('builtin_tools_invoke', { name: 'tool_42', args: {} }, 'i1')]),
      calls([call('read_file', { path: 'a.ts' }, 'c3')]),
      reply('Used tool_42 and read a.ts.'),
    ]);
    await h.start({ userTurn: 'use tool 42, then read a.ts' });
  },
};

export const mcpTool: Scenario = {
  id: 'mcp-tool', rows: ['R9'], loopShows: ['mcp__github__list_issues'], title: 'an MCP tool on the catalog is offered with its namespaced name and runs through the host',
  async run(h) {
    h.tools({ ...READ, mcp__github__list_issues: () => ({ ok: true, issues: [{ number: 7, title: 'Bug' }] }) });
    h.script([calls([call('mcp__github__list_issues', { repo: 'acme/web' }, 'm1')]), reply('There is one open issue: #7 Bug.')]);
    await h.start({ userTurn: 'what issues are open in acme/web?' });
  },
};

export const hostWithoutRunner: Scenario = {
  id: 'tools-without-runner', rows: ['R9'], title: 'a host that offers tools but no runTool still answers; ask_user is not advertised',
  async run(h) {
    h.script([reply('I have no way to run those, but here is the answer.')]);
    await h.start({ tools: [{ type: 'function', function: { name: 'read_file', description: 'read', parameters: {} } }], userTurn: 'have a look' });
  },
};

const PLAN = {
  summary: 'The title is rendered by SurfaceHeader via VsCodeChatHeader.',
  tasks: [
    { title: 'Drop the header title', brief: 'Stop passing the project title to SurfaceHeader.', paths: ['clients/vscode/webview/src/chat/VsCodeChatHeader.tsx'] },
    { title: 'Let SurfaceHeader omit its title', brief: 'Render no title span when given none.', paths: ['packages/brain-ui/src/surface/SurfaceHeader.tsx'] },
  ],
};

export const handOffExecution: Scenario = {
  id: 'hand-off-execution', rows: ['R11', 'T9'], loopShows: ['loop.hand_off_due', 'spawn_agents', 'edit_file'], title: 'analysis ends at the budget, the forced hand_off files a ticket per task and fans out coders, and coding follows on the code role',
  async run(h) {
    let ticket = 900;
    h.tools({
      ...READ,
      edit_file: () => ({ ok: true }),
      builtin_tasks_create: () => ({ id: (ticket += 1) }),
      spawn_agents: (a) => ({ ok: true, workstreams: ((a as { workstreams: unknown[] }).workstreams).map(() => ({ ok: true })), changedFiles: [PLAN.tasks[0]!.paths[0]] }),
    });
    let reads = 0;
    let edited = false;
    h.react(decide(({ opts }) => {
      const names = (opts.tools ?? []).map((t) => t.function.name);
      if (names.length === 1 && names[0] === 'hand_off') return completion({ text: 'The analysis is done.', toolCalls: [call('hand_off', PLAN, 'h1')], finishReason: 'tool_calls' });
      if (opts.role === 'plan') { reads += 1; return completion({ toolCalls: [call('read_file', { path: `src/file${reads}.ts` }, `r${reads}`)], finishReason: 'tool_calls' }); }
      if (opts.tools && !edited) { edited = true; return completion({ toolCalls: [call('edit_file', { path: PLAN.tasks[0]!.paths[0], old: 'title={', new: 'title={null} data-was={' }, 'e1')], finishReason: 'tool_calls' }); }
      return completion({ text: 'Removed the title; the header now starts with the chat name.' });
    }));
    await h.start({ projectId: 11, userTurn: 'remove the title from the top of the VSIX' });
  },
};

export const plannerIgnoresForcedTurn: Scenario = {
  id: 'planner-ignores-forced-turn', rows: ['R11', 'T9'], loopShows: ['loop.plan_budget_spent', 'edit_file'], title: 'a planner that keeps reading through the forced hand_off turn ends planning; the coder takes the next turn',
  async run(h) {
    h.tools({ ...READ, edit_file: () => ({ ok: true }) });
    let reads = 0;
    let edited = false;
    h.react(decide(({ opts }) => {
      const names = (opts.tools ?? []).map((t) => t.function.name);
      if (opts.role === 'plan' || (names.length === 1 && names[0] === 'hand_off')) { reads += 1; return completion({ toolCalls: [call('read_file', { path: `src/f${reads}.ts` }, `r${reads}`)], finishReason: 'tool_calls' }); }
      if (opts.tools && !edited) { edited = true; return completion({ toolCalls: [call('edit_file', { path: 'a.ts', old: 'a', new: 'b' }, 'e1')], finishReason: 'tool_calls' }); }
      return completion({ text: 'Done.' });
    }));
    await h.start({ userTurn: 'remove the title from the top of the VSIX' });
  },
};

export const toolScenarios: Scenario[] = [
  askUserTerminal, askUserMalformed, malformedCallArgs, unknownTool, confirmApproved, confirmDeclined, readDedupe, bigReadPaged,
  routedToolPin, mcpTool, hostWithoutRunner, handOffExecution, plannerIgnoresForcedTurn,
];
